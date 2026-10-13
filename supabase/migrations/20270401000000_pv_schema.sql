-- Pós-Venda e Reativação de Clientes — SCHEMA, AUTORIZAÇÃO E SEGURANÇA (parte 1)
-- Depende das migrações do Core. Arquivo do sistema: pode ser editado.
-- Princípios: toda tabela com organization_id + RLS; RFM é histórico imutável; escrita sensível (compras, importação, estados,
-- campanhas, oportunidades) só por funções (parte 2); vendedor só enxerga os clientes atribuídos a ele.

begin;

-- ======================================================================= tipos
create type public.pv_purchase_status as enum ('completed', 'cancelled');
create type public.pv_opp_status as enum ('open', 'in_progress', 'reactivated', 'discarded');
create type public.pv_opp_reason as enum ('inactivity', 'cycle', 'frequency_drop', 'segment_change');
create type public.pv_campaign_status as enum ('draft', 'planned', 'running', 'paused', 'completed', 'cancelled');
create type public.pv_channel as enum ('phone', 'whatsapp', 'email');
create type public.pv_member_status as enum ('eligible', 'assigned', 'contacted', 'responded', 'no_response', 'refused', 'rebought', 'excluded');
create type public.pv_contact_status as enum ('planned', 'contacted', 'responded', 'no_response', 'refused');
create type public.pv_activity_type as enum ('call', 'email', 'message', 'meeting', 'follow_up', 'after_sales', 'other');
create type public.pv_permission as enum ('granted', 'legitimate_interest', 'denied');

-- ======================================================================= autorização
create function private.pv_role(org uuid) returns public.org_role
language sql stable security definer set search_path = '' as $$
  select m.role from public.organization_members m where m.organization_id = org and m.user_id = (select auth.uid());
$$;
-- Leitura: administração, gestão e leitor veem tudo; vendedor só os clientes atribuídos a ele.
create function private.pv_can_read(org uuid, assignee uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(case private.pv_role(org)
    when 'owner' then true when 'admin' then true when 'manager' then true when 'viewer' then true
    when 'member' then assignee is not distinct from (select auth.uid()) else false end, false);
$$;
create function private.pv_can_write(org uuid, assignee uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(case private.pv_role(org)
    when 'owner' then true when 'admin' then true when 'manager' then true
    when 'member' then assignee is not distinct from (select auth.uid()) else false end, false);
$$;
create function private.pv_is_manager(org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.pv_role(org) in ('owner', 'admin', 'manager'), false);
$$;
create function private.pv_is_admin(org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.pv_role(org) in ('owner', 'admin'), false);
$$;
-- O cliente é visível para quem consulta? (usado pelas tabelas filhas)
create function private.pv_cust_visible(p_customer uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin return exists (select 1 from public.customers c where c.id = p_customer and private.pv_can_read(c.organization_id, c.assigned_to)); end $$;

create function private.pv_cust_writable(p_customer uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin return exists (select 1 from public.customers c where c.id = p_customer and private.pv_can_write(c.organization_id, c.assigned_to)); end $$;

do $$
declare f text;
begin
  foreach f in array array['private.pv_role(uuid)', 'private.pv_can_read(uuid, uuid)', 'private.pv_can_write(uuid, uuid)', 'private.pv_is_manager(uuid)', 'private.pv_is_admin(uuid)', 'private.pv_cust_visible(uuid)', 'private.pv_cust_writable(uuid)'] loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- ======================================================================= normalização
create function private.pv_norm_email(t text) returns text language sql immutable set search_path = '' as $$ select nullif(lower(btrim(coalesce(t, ''))), ''); $$;
create function private.pv_norm_phone(t text) returns text language plpgsql immutable set search_path = '' as $$
declare d text := regexp_replace(coalesce(t, ''), '\D', '', 'g');
begin
  if d like '00%' then d := substr(d, 3); end if;
  if char_length(d) in (10, 11) then d := '55' || d; end if;
  return case when char_length(d) between 8 and 15 then d end;
end $$;
create function private.pv_norm_doc(t text) returns text language sql immutable set search_path = '' as $$
  select nullif(regexp_replace(coalesce(t, ''), '\D', '', 'g'), '');
$$;
do $$
declare f text;
begin
  foreach f in array array['private.pv_norm_email(text)', 'private.pv_norm_phone(text)', 'private.pv_norm_doc(text)'] loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- ======================================================================= configuração
create table public.pv_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  timezone text not null default 'America/Sao_Paulo' check (char_length(timezone) between 3 and 60),
  rfm_window_days integer not null default 365 check (rfm_window_days between 30 and 1095),
  rfm_mode text not null default 'percentile' check (rfm_mode in ('percentile', 'fixed')),
  rfm_limits jsonb not null default '{"r":[30,60,90,180],"f":[2,3,5,8],"m":[10000,30000,100000,300000]}'::jsonb check (jsonb_typeof(rfm_limits) = 'object'),
  new_customer_days integer not null default 30 check (new_customer_days between 1 and 365),
  risk_days integer not null default 90 check (risk_days between 7 and 1095),
  inactive_days integer not null default 180 check (inactive_days between 14 and 1825),
  cycle_factor numeric(4, 2) not null default 1.5 check (cycle_factor between 1.1 and 10),
  cycle_min_purchases integer not null default 3 check (cycle_min_purchases between 3 and 20),
  cycle_min_days integer not null default 15 check (cycle_min_days between 1 and 365),
  drop_window_days integer not null default 90 check (drop_window_days between 30 and 365),
  drop_pct integer not null default 50 check (drop_pct between 10 and 100),
  drop_min_prev integer not null default 2 check (drop_min_prev between 2 and 50),
  rule_inactivity boolean not null default true,
  rule_cycle boolean not null default true,
  rule_drop boolean not null default true,
  rule_segment_change boolean not null default true,
  observation_days integer not null default 30 check (observation_days between 7 and 365),
  w_value integer not null default 40 check (w_value between 0 and 100),
  w_frequency integer not null default 20 check (w_frequency between 0 and 100),
  w_overdue integer not null default 40 check (w_overdue between 0 and 100),
  priority_high integer not null default 70 check (priority_high between 1 and 100),
  priority_medium integer not null default 40 check (priority_medium between 1 and 100),
  alert_overdue_tasks boolean not null default true,
  updated_at timestamptz not null default now(),
  check (risk_days < inactive_days),
  check (w_value + w_frequency + w_overdue > 0),
  check (priority_medium < priority_high)
);

-- Limites fixos de RFM: três listas de 4 números crescentes.
create function private.pv_check_limits() returns trigger language plpgsql set search_path = '' as $$
declare k text; a jsonb;
begin
  foreach k in array array['r', 'f', 'm'] loop
    a := new.rfm_limits -> k;
    if jsonb_typeof(a) <> 'array' or jsonb_array_length(a) <> 4 then raise exception 'limites de RFM inválidos' using errcode = '23514'; end if;
    if not (select bool_and(jsonb_typeof(x) = 'number' and (x #>> '{}')::numeric >= 0) from jsonb_array_elements(a) x)
       or (a ->> 0)::numeric >= (a ->> 1)::numeric or (a ->> 1)::numeric >= (a ->> 2)::numeric or (a ->> 2)::numeric >= (a ->> 3)::numeric then
      raise exception 'limites de RFM devem ser 4 números crescentes' using errcode = '23514';
    end if;
  end loop;
  return new;
end $$;
create trigger pv_settings_limits before insert or update of rfm_limits on public.pv_settings for each row execute function private.pv_check_limits();

-- ======================================================================= clientes e compras
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 160),
  email text check (email is null or (email = lower(email) and char_length(email) <= 254 and email ~ '^[^@\s]+@[^@\s]+$')),
  phone text check (phone is null or phone ~ '^[0-9]{8,15}$'),
  company_name text check (company_name is null or char_length(company_name) <= 160),
  document_number text check (document_number is null or document_number ~ '^[0-9]{11}$|^[0-9]{14}$'),
  customer_type text not null default 'person' check (customer_type in ('person', 'company')),
  status text not null default 'active' check (status in ('active', 'archived')),
  external_customer_id text check (external_customer_id is null or char_length(external_customer_id) <= 80),
  assigned_to uuid,
  notes text check (notes is null or char_length(notes) <= 4000),
  anonymized_at timestamptz,
  custom jsonb not null default '{}'::jsonb check (jsonb_typeof(custom) = 'object' and pg_column_size(custom) <= 8192),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (id, organization_id),
  foreign key (organization_id, assigned_to) references public.organization_members (organization_id, user_id) on delete set null (assigned_to)
);
create unique index customers_email_uniq on public.customers (organization_id, email) where email is not null and archived_at is null;
create unique index customers_doc_uniq on public.customers (organization_id, document_number) where document_number is not null and archived_at is null;
create unique index customers_ext_uniq on public.customers (organization_id, external_customer_id) where external_customer_id is not null and archived_at is null;
create index customers_org_idx on public.customers (organization_id, status, created_at desc);
create index customers_assignee_idx on public.customers (organization_id, assigned_to);

create table public.import_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null check (kind in ('customers', 'purchases')),
  file_name text not null check (char_length(file_name) <= 200),
  source text check (source is null or char_length(source) <= 80),
  file_hash text check (file_hash is null or file_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'processing' check (status in ('processing', 'completed', 'failed')),
  total_rows integer not null default 0,
  accepted_rows integer not null default 0,
  rejected_rows integer not null default 0,
  duplicate_rows integer not null default 0,
  mapping_json jsonb not null default '{}'::jsonb,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (id, organization_id)
);
create index import_jobs_org_idx on public.import_jobs (organization_id, created_at desc);

create table public.import_row_errors (
  id bigint generated always as identity primary key,
  organization_id uuid not null,
  import_job_id uuid not null,
  row_number integer not null,
  error_code text not null,
  error_message text not null check (char_length(error_message) <= 300),
  foreign key (import_job_id, organization_id) references public.import_jobs (id, organization_id) on delete cascade
);
create index import_row_errors_job_idx on public.import_row_errors (import_job_id, row_number);

create table public.purchases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  customer_id uuid not null,
  external_order_id text check (external_order_id is null or char_length(external_order_id) <= 80),
  dedup_key text,
  purchased_at timestamptz not null,
  total_cents bigint not null check (total_cents >= 0 and total_cents <= 100000000000),
  refunded_cents bigint not null default 0 check (refunded_cents >= 0),
  net_cents bigint generated always as (total_cents - refunded_cents) stored,
  currency text not null default 'BRL' check (currency = 'BRL'),
  status public.pv_purchase_status not null default 'completed',
  is_valid boolean generated always as (status = 'completed' and total_cents - refunded_cents > 0) stored,
  source text check (source is null or char_length(source) <= 80),
  notes text check (notes is null or char_length(notes) <= 1000),
  import_job_id uuid,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (refunded_cents <= total_cents),
  unique (id, organization_id),
  foreign key (customer_id, organization_id) references public.customers (id, organization_id) on delete cascade,
  foreign key (import_job_id, organization_id) references public.import_jobs (id, organization_id) on delete set null (import_job_id)
);
create unique index purchases_ext_uniq on public.purchases (organization_id, external_order_id) where external_order_id is not null;
create unique index purchases_dedup_uniq on public.purchases (organization_id, dedup_key) where dedup_key is not null;
create index purchases_customer_idx on public.purchases (customer_id, purchased_at desc);
create index purchases_org_date_idx on public.purchases (organization_id, purchased_at desc) where is_valid;

create table public.purchase_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  purchase_id uuid not null,
  product_name text not null check (char_length(product_name) between 1 and 200),
  product_sku text check (product_sku is null or char_length(product_sku) <= 80),
  category text check (category is null or char_length(category) <= 80),
  quantity numeric(12, 3) not null default 1 check (quantity > 0),
  unit_price_cents bigint not null default 0 check (unit_price_cents >= 0),
  total_cents bigint not null default 0 check (total_cents >= 0),
  foreign key (purchase_id, organization_id) references public.purchases (id, organization_id) on delete cascade
);
create index purchase_items_purchase_idx on public.purchase_items (purchase_id);
create index purchase_items_cat_idx on public.purchase_items (organization_id, category);

-- ======================================================================= RFM (histórico imutável)
create table public.rfm_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  model_version integer not null check (model_version >= 1),
  reference_date date not null,
  window_days integer not null check (window_days between 30 and 1095),
  mode text not null check (mode in ('percentile', 'fixed')),
  params_json jsonb not null,
  scored_count integer not null default 0,
  low_sample boolean not null default false,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (organization_id, model_version)
);
create table public.customer_rfm_scores (
  id bigint generated always as identity primary key,
  organization_id uuid not null,
  run_id uuid not null,
  customer_id uuid not null,
  model_version integer not null,
  reference_date date not null,
  recency_days integer,
  frequency integer,
  monetary_cents bigint,
  r_score smallint check (r_score between 1 and 5),
  f_score smallint check (f_score between 1 and 5),
  m_score smallint check (m_score between 1 and 5),
  segment_key text not null check (segment_key in ('campeoes', 'fieis', 'novos', 'promissores', 'em_risco', 'atencao', 'inativos', 'sem_compras')),
  calculated_at timestamptz not null default now(),
  unique (run_id, customer_id),
  foreign key (run_id, organization_id) references public.rfm_runs (id, organization_id) on delete cascade,
  foreign key (customer_id, organization_id) references public.customers (id, organization_id) on delete cascade
);
create index rfm_scores_customer_idx on public.customer_rfm_scores (customer_id, run_id);
create index rfm_scores_run_seg_idx on public.customer_rfm_scores (run_id, segment_key);

create function private.pv_append_only() returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'histórico imutável: não pode ser alterado' using errcode = '23514'; end $$;
create trigger rfm_runs_immutable before update on public.rfm_runs for each row execute function private.pv_append_only();
create trigger rfm_scores_immutable before update on public.customer_rfm_scores for each row execute function private.pv_append_only();

-- ======================================================================= segmentos
create table public.segment_definitions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 120),
  description text check (description is null or char_length(description) <= 600),
  criteria_json jsonb not null check (jsonb_typeof(criteria_json) = 'object' and pg_column_size(criteria_json) <= 8192),
  segment_type text not null default 'custom' check (segment_type in ('custom', 'system')),
  active boolean not null default true,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id)
);
create table public.segment_memberships (
  organization_id uuid not null,
  segment_id uuid not null,
  customer_id uuid not null,
  evaluated_at timestamptz not null default now(),
  primary key (segment_id, customer_id),
  foreign key (segment_id, organization_id) references public.segment_definitions (id, organization_id) on delete cascade,
  foreign key (customer_id, organization_id) references public.customers (id, organization_id) on delete cascade
);

-- ======================================================================= ciclo de vida e oportunidades
create table public.customer_lifecycle_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null,
  customer_id uuid not null,
  event_type text not null check (event_type in ('first_purchase', 'purchase', 'at_risk', 'inactive', 'reactivated', 'segment_changed', 'contact', 'campaign_added')),
  event_key text,
  metadata jsonb not null default '{}'::jsonb check (pg_column_size(metadata) <= 8192),
  occurred_at timestamptz not null default now(),
  foreign key (customer_id, organization_id) references public.customers (id, organization_id) on delete cascade
);
create unique index lifecycle_key_uniq on public.customer_lifecycle_events (organization_id, event_key) where event_key is not null;
create index lifecycle_customer_idx on public.customer_lifecycle_events (customer_id, occurred_at desc);
create index lifecycle_type_idx on public.customer_lifecycle_events (organization_id, event_type, occurred_at);

create table public.reactivation_opportunities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  customer_id uuid not null,
  reason public.pv_opp_reason not null,
  priority integer not null check (priority between 0 and 100),
  estimated_value_cents bigint check (estimated_value_cents is null or estimated_value_cents >= 0),
  explanation_json jsonb not null default '{}'::jsonb check (pg_column_size(explanation_json) <= 8192),
  status public.pv_opp_status not null default 'open',
  assigned_to uuid,
  next_action text check (next_action is null or char_length(next_action) <= 300),
  discard_reason text check (discard_reason is null or char_length(discard_reason) <= 300),
  last_contact_at timestamptz,
  reactivated_purchase_id uuid,
  identified_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (id, organization_id),
  foreign key (customer_id, organization_id) references public.customers (id, organization_id) on delete cascade,
  foreign key (organization_id, assigned_to) references public.organization_members (organization_id, user_id) on delete set null (assigned_to),
  foreign key (reactivated_purchase_id, organization_id) references public.purchases (id, organization_id) on delete set null (reactivated_purchase_id),
  check ((status in ('reactivated', 'discarded')) = (resolved_at is not null))
);
create unique index opp_open_uniq on public.reactivation_opportunities (organization_id, customer_id, reason) where status in ('open', 'in_progress');
create index opp_org_status_idx on public.reactivation_opportunities (organization_id, status, priority desc);

-- ======================================================================= campanhas
create table public.message_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  template_key text not null check (template_key ~ '^[a-z0-9_]{2,40}$'),
  name text not null check (char_length(name) between 2 and 120),
  channel public.pv_channel not null default 'whatsapp',
  subject text check (subject is null or char_length(subject) <= 200),
  body text not null check (char_length(body) between 1 and 4000),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, template_key)
);

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 120),
  description text check (description is null or char_length(description) <= 1000),
  objective text check (objective is null or char_length(objective) <= 300),
  channel public.pv_channel not null,
  status public.pv_campaign_status not null default 'draft',
  segment_id uuid,
  message_body text check (message_body is null or char_length(message_body) <= 4000),
  message_subject text check (message_subject is null or char_length(message_subject) <= 200),
  owner_id uuid,
  observation_days integer not null default 30 check (observation_days between 7 and 365),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  scheduled_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (segment_id, organization_id) references public.segment_definitions (id, organization_id) on delete set null (segment_id),
  foreign key (organization_id, owner_id) references public.organization_members (organization_id, user_id) on delete set null (owner_id)
);
create table public.campaign_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  campaign_id uuid not null,
  customer_id uuid not null,
  eligibility_snapshot_json jsonb not null default '{}'::jsonb check (pg_column_size(eligibility_snapshot_json) <= 4096),
  status public.pv_member_status not null default 'eligible',
  exclusion_reason text check (exclusion_reason is null or char_length(exclusion_reason) <= 200),
  assigned_to uuid,
  created_at timestamptz not null default now(),
  unique (campaign_id, customer_id),
  foreign key (campaign_id, organization_id) references public.campaigns (id, organization_id) on delete cascade,
  foreign key (customer_id, organization_id) references public.customers (id, organization_id) on delete cascade
);
create table public.campaign_contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  campaign_id uuid not null,
  customer_id uuid not null,
  contact_method public.pv_channel not null,
  contact_status public.pv_contact_status not null default 'planned',
  contacted_by uuid default auth.uid() references auth.users(id) on delete set null,
  contacted_at timestamptz,
  notes text check (notes is null or char_length(notes) <= 2000),
  created_at timestamptz not null default now(),
  foreign key (campaign_id, organization_id) references public.campaigns (id, organization_id) on delete cascade,
  foreign key (customer_id, organization_id) references public.customers (id, organization_id) on delete cascade
);
create index campaign_contacts_idx on public.campaign_contacts (campaign_id, customer_id, created_at);
create table public.campaign_outcomes (
  id bigint generated always as identity primary key,
  organization_id uuid not null,
  campaign_id uuid not null,
  customer_id uuid not null,
  outcome_type text not null check (outcome_type in ('rebought')),
  related_purchase_id uuid not null,
  outcome_at timestamptz not null,
  unique (campaign_id, customer_id, related_purchase_id),
  foreign key (campaign_id, organization_id) references public.campaigns (id, organization_id) on delete cascade,
  foreign key (customer_id, organization_id) references public.customers (id, organization_id) on delete cascade,
  foreign key (related_purchase_id, organization_id) references public.purchases (id, organization_id) on delete cascade
);

-- ======================================================================= atividades, preferências, supressão, notificações
create table public.customer_activities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  customer_id uuid not null,
  user_id uuid default auth.uid() references auth.users(id) on delete set null,
  assigned_to uuid,
  type public.pv_activity_type not null default 'other',
  title text check (title is null or char_length(title) <= 160),
  description text check (description is null or char_length(description) <= 2000),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  campaign_id uuid,
  opportunity_id uuid,
  due_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (customer_id, organization_id) references public.customers (id, organization_id) on delete cascade,
  foreign key (campaign_id, organization_id) references public.campaigns (id, organization_id) on delete set null (campaign_id),
  foreign key (opportunity_id, organization_id) references public.reactivation_opportunities (id, organization_id) on delete set null (opportunity_id)
);
create index activities_customer_idx on public.customer_activities (customer_id, created_at desc);
create index activities_open_idx on public.customer_activities (organization_id, due_at) where completed_at is null;

create table public.communication_preferences (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  customer_id uuid not null,
  channel public.pv_channel not null,
  permission_status public.pv_permission not null,
  legal_basis_reference text check (legal_basis_reference is null or char_length(legal_basis_reference) <= 300),
  updated_by uuid default auth.uid() references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (customer_id, channel),
  foreign key (customer_id, organization_id) references public.customers (id, organization_id) on delete cascade
);
create table public.suppression_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  customer_id uuid not null,
  channel public.pv_channel,
  reason text not null check (char_length(reason) between 1 and 300),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  lifted_at timestamptz,
  foreign key (customer_id, organization_id) references public.customers (id, organization_id) on delete cascade
);
create index suppression_customer_idx on public.suppression_entries (customer_id) where lifted_at is null;

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (char_length(type) <= 40),
  title text not null check (char_length(title) <= 160),
  body text check (body is null or char_length(body) <= 600),
  link text check (link is null or link ~ '^/[a-z0-9/_-]*$'),
  dedup_key text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index notifications_dedup_uniq on public.notifications (user_id, dedup_key) where dedup_key is not null;
create index notifications_user_idx on public.notifications (user_id, created_at desc);

-- ======================================================================= gatilhos
do $$
declare t text;
begin
  foreach t in array array['pv_settings', 'customers', 'segment_definitions', 'campaigns', 'message_templates'] loop
    execute format('create trigger %I before update on public.%I for each row execute function private.set_updated_at()', t || '_updated_at', t);
  end loop;
end $$;

-- Normaliza contato; vendedor só cria cliente para si.
create function private.pv_customer_normalize() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.email := private.pv_norm_email(new.email);
  if new.phone is not null then new.phone := private.pv_norm_phone(new.phone); end if;
  new.document_number := private.pv_norm_doc(new.document_number);
  new.name := coalesce(nullif(btrim(new.name), ''), 'Sem nome');
  new.status := case when new.archived_at is null then 'active' else 'archived' end;
  if tg_op = 'INSERT' and (select auth.uid()) is not null and private.pv_role(new.organization_id) = 'member' then
    new.assigned_to := (select auth.uid());
  end if;
  return new;
end $$;
revoke all on function private.pv_customer_normalize() from public;
create trigger customers_normalize before insert or update of email, phone, name, document_number, archived_at on public.customers for each row execute function private.pv_customer_normalize();

-- ======================================================================= padrões por organização
create function private.pv_bootstrap_org(org uuid) returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.pv_settings (organization_id) values (org) on conflict do nothing;
  insert into public.message_templates (organization_id, template_key, name, channel, subject, body) values
    (org, 'cliente_inativo', 'Cliente inativo', 'whatsapp', null, 'Olá, {{nome|tudo bem}}! Faz um tempo que não nos falamos. Posso te ajudar com algo? — {{vendedor|equipe}}, {{empresa|nossa equipe}}'),
    (org, 'reposicao', 'Reposição de produto', 'whatsapp', null, 'Olá, {{nome|tudo bem}}! Pelo seu histórico, {{produto|seu último pedido}} deve estar acabando. Quer que eu separe uma nova reposição? — {{vendedor|equipe}}'),
    (org, 'alto_valor', 'Cliente de alto valor', 'phone', null, 'Roteiro de ligação: agradecer a parceria com {{empresa|a empresa}}, perguntar como estão os resultados com {{produto|nossos produtos}} e entender novas necessidades.'),
    (org, 'pos_compra', 'Pós-compra', 'whatsapp', null, 'Olá, {{nome|tudo bem}}! Como foi a sua experiência com {{produto|a sua compra}}? Se precisar de qualquer coisa, estou à disposição. — {{vendedor|equipe}}'),
    (org, 'oferta_retorno', 'Oferta de retorno', 'email', 'Uma condição especial para você voltar', 'Olá, {{nome|tudo bem}}! Preparamos uma condição especial para o seu retorno. Defina aqui a oferta e as regras (a empresa decide o conteúdo). — {{vendedor|equipe}}'),
    (org, 'reativacao_b2b', 'Reativação B2B', 'email', 'Vamos retomar a nossa parceria?', 'Prezado(a) {{nome|cliente}}, notamos que {{empresa|a sua empresa}} não realiza pedidos há algum tempo. Gostaríamos de entender se algo mudou e como podemos apoiar. — {{vendedor|equipe}}')
  on conflict do nothing;
  insert into public.segment_definitions (organization_id, name, description, criteria_json, segment_type) values
    (org, 'Clientes em risco', 'Clientes que atendem às regras de risco atuais.', '{"match":"all","conditions":[{"field":"state","op":"eq","value":"at_risk"}]}', 'system'),
    (org, 'Clientes inativos', 'Sem compra há mais tempo que o limite de inatividade.', '{"match":"all","conditions":[{"field":"state","op":"eq","value":"inactive"}]}', 'system'),
    (org, 'Campeões (RFM)', 'Melhores clientes pela rodada RFM mais recente.', '{"match":"all","conditions":[{"field":"rfm_segment","op":"in","value":["campeoes"]}]}', 'system')
  on conflict do nothing;
end $$;
revoke all on function private.pv_bootstrap_org(uuid) from public;
create function private.pv_on_org_created() returns trigger language plpgsql security definer set search_path = '' as $$
begin perform private.pv_bootstrap_org(new.id); return null; end $$;
revoke all on function private.pv_on_org_created() from public;
create trigger pv_on_org_created after insert on public.organizations for each row execute function private.pv_on_org_created();
select private.pv_bootstrap_org(id) from public.organizations;

do $$
declare t text;
begin
  foreach t in array array['customers', 'segment_definitions', 'campaigns', 'message_templates', 'suppression_entries', 'communication_preferences'] loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function private.audit_trigger(%L, %L)', 'audit_' || t, t, 'organization_id', 'id');
  end loop;
  create trigger audit_pv_settings after update on public.pv_settings for each row execute function private.audit_trigger('organization_id', 'organization_id');
end $$;

-- ======================================================================= RLS
do $$
declare t text;
begin
  foreach t in array array['pv_settings', 'customers', 'import_jobs', 'import_row_errors', 'purchases', 'purchase_items', 'rfm_runs', 'customer_rfm_scores', 'segment_definitions', 'segment_memberships',
    'customer_lifecycle_events', 'reactivation_opportunities', 'message_templates', 'campaigns', 'campaign_memberships', 'campaign_contacts', 'campaign_outcomes', 'customer_activities',
    'communication_preferences', 'suppression_entries', 'notifications'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

create policy pv_settings_select on public.pv_settings for select to authenticated using (private.is_member(organization_id));
create policy pv_settings_update on public.pv_settings for update to authenticated using (private.pv_is_admin(organization_id)) with check (private.pv_is_admin(organization_id));

create policy customers_select on public.customers for select to authenticated using (private.pv_can_read(organization_id, assigned_to));
create policy customers_insert on public.customers for insert to authenticated with check (private.pv_role(organization_id) in ('owner', 'admin', 'manager', 'member'));
create policy customers_update on public.customers for update to authenticated using (private.pv_can_write(organization_id, assigned_to)) with check (private.pv_can_write(organization_id, assigned_to));

create policy import_jobs_select on public.import_jobs for select to authenticated using (private.pv_is_manager(organization_id));
create policy import_errors_select on public.import_row_errors for select to authenticated using (private.pv_is_manager(organization_id));

-- Tabelas filhas: lê quem enxerga o cliente.
do $$
declare t text;
begin
  foreach t in array array['purchases', 'customer_rfm_scores', 'customer_lifecycle_events', 'reactivation_opportunities', 'campaign_memberships', 'campaign_contacts', 'campaign_outcomes',
    'communication_preferences', 'suppression_entries', 'segment_memberships'] loop
    execute format('create policy %I on public.%I for select to authenticated using (private.pv_cust_visible(customer_id))', t || '_select', t);
  end loop;
end $$;
create policy purchase_items_select on public.purchase_items for select to authenticated
  using (exists (select 1 from public.purchases p where p.id = purchase_id and private.pv_cust_visible(p.customer_id)));
create policy rfm_runs_select on public.rfm_runs for select to authenticated using (private.pv_is_manager(organization_id) or private.pv_role(organization_id) in ('viewer', 'member'));

create policy segments_select on public.segment_definitions for select to authenticated using (private.is_member(organization_id));
create policy segments_insert on public.segment_definitions for insert to authenticated with check (private.pv_is_manager(organization_id) and segment_type = 'custom');
create policy segments_update on public.segment_definitions for update to authenticated using (private.pv_is_manager(organization_id)) with check (private.pv_is_manager(organization_id));
create policy segments_delete on public.segment_definitions for delete to authenticated using (private.pv_is_manager(organization_id) and segment_type = 'custom');

create policy templates_select on public.message_templates for select to authenticated using (private.is_member(organization_id));
create policy templates_insert on public.message_templates for insert to authenticated with check (private.pv_is_manager(organization_id));
create policy templates_update on public.message_templates for update to authenticated using (private.pv_is_manager(organization_id)) with check (private.pv_is_manager(organization_id));
create policy templates_delete on public.message_templates for delete to authenticated using (private.pv_is_manager(organization_id));

create policy campaigns_select on public.campaigns for select to authenticated using (private.is_member(organization_id));
create policy campaigns_insert on public.campaigns for insert to authenticated with check (private.pv_is_manager(organization_id));
create policy campaigns_update on public.campaigns for update to authenticated using (private.pv_is_manager(organization_id)) with check (private.pv_is_manager(organization_id));

create policy activities_select on public.customer_activities for select to authenticated using (private.pv_cust_visible(customer_id));
create policy activities_insert on public.customer_activities for insert to authenticated with check (private.pv_cust_writable(customer_id));
create policy activities_update on public.customer_activities for update to authenticated using (private.pv_cust_writable(customer_id)) with check (private.pv_cust_writable(customer_id));
create policy activities_delete on public.customer_activities for delete to authenticated using (private.pv_is_manager(organization_id));

create policy notifications_select on public.notifications for select to authenticated using (user_id = (select auth.uid()));
create policy notifications_update on public.notifications for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- MFA no banco (padrão do Core) para as escritas diretas.
do $$
declare t text;
begin
  foreach t in array array['pv_settings', 'customers', 'segment_definitions', 'campaigns', 'message_templates', 'customer_activities', 'notifications'] loop
    execute format('create policy mfa_insert on public.%I as restrictive for insert to authenticated with check (private.mfa_ok())', t);
    execute format('create policy mfa_update on public.%I as restrictive for update to authenticated using (private.mfa_ok()) with check (private.mfa_ok())', t);
    execute format('create policy mfa_delete on public.%I as restrictive for delete to authenticated using (private.mfa_ok())', t);
  end loop;
end $$;

-- Privilégios por coluna (status, atribuição, estados e números só por funções).
grant insert (organization_id, name, email, phone, company_name, document_number, customer_type, external_customer_id, notes, assigned_to) on public.customers to authenticated;
grant update (name, email, phone, company_name, document_number, customer_type, external_customer_id, notes, custom, archived_at) on public.customers to authenticated;
grant update (timezone, rfm_window_days, rfm_mode, rfm_limits, new_customer_days, risk_days, inactive_days, cycle_factor, cycle_min_purchases, cycle_min_days, drop_window_days, drop_pct, drop_min_prev,
  rule_inactivity, rule_cycle, rule_drop, rule_segment_change, observation_days, w_value, w_frequency, w_overdue, priority_high, priority_medium, alert_overdue_tasks) on public.pv_settings to authenticated;
grant insert (organization_id, name, description, criteria_json, segment_type, active) on public.segment_definitions to authenticated;
grant update (name, description, criteria_json, active) on public.segment_definitions to authenticated;
grant delete on public.segment_definitions to authenticated;
grant insert (organization_id, template_key, name, channel, subject, body, active) on public.message_templates to authenticated;
grant update (name, channel, subject, body, active) on public.message_templates to authenticated;
grant delete on public.message_templates to authenticated;
grant insert (organization_id, name, description, objective, channel, segment_id, message_body, message_subject, owner_id, observation_days, scheduled_at) on public.campaigns to authenticated;
grant update (name, description, objective, channel, segment_id, message_body, message_subject, owner_id, observation_days, scheduled_at) on public.campaigns to authenticated;
grant insert (organization_id, customer_id, type, title, description, priority, assigned_to, campaign_id, opportunity_id, due_at, completed_at) on public.customer_activities to authenticated;
grant update (type, title, description, priority, assigned_to, due_at, completed_at) on public.customer_activities to authenticated;
grant delete on public.customer_activities to authenticated;
grant update (read_at) on public.notifications to authenticated;

commit;
