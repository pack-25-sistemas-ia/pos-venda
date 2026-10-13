-- Pós-Venda e Reativação — INDICADORES (parte 4). Fonte única dos números do painel, dos relatórios e dos CSV. Definições: docs/METRICS.md.
-- Funções security INVOKER: o RLS já limita o que cada papel enxerga (vendedor só os clientes dele). Período no fuso da organização.
-- Nomenclatura honesta: «observado» ≠ «causado». Nada aqui afirma receita incremental.

begin;

create function private.pv_window(p_org uuid, p_from date, p_to date) returns table (t0 timestamptz, t1 timestamptz, tz text, ref date)
language plpgsql stable security invoker set search_path = '' as $$
declare v_tz text;
begin
  if p_org is null or p_from is null or p_to is null or p_to < p_from or p_to - p_from > 1100 then raise exception 'período inválido' using errcode = '22023'; end if;
  select s.timezone into v_tz from public.pv_settings s where s.organization_id = p_org;
  v_tz := coalesce(v_tz, 'America/Sao_Paulo');
  if not exists (select 1 from pg_timezone_names n where n.name = v_tz) then v_tz := 'America/Sao_Paulo'; end if;
  return query select (p_from::timestamp at time zone v_tz), ((p_to + 1)::timestamp at time zone v_tz), v_tz, least(p_to, (now() at time zone v_tz)::date);
end $$;

-- Clientes dentro dos filtros globais (estado e segmento calculados na data de referência).
create function private.pv_scope(p_org uuid, p_ref date, p_seller uuid, p_segment text, p_status text)
returns table (customer_id uuid, state text, seg text, n_valid integer, last_at date, days_since integer)
language plpgsql stable security invoker set search_path = '' as $$
declare run uuid;
begin
  select r.id into run from public.rfm_runs r where r.organization_id = p_org order by r.model_version desc limit 1;
  return query
  select g.customer_id, g.state, sc.segment_key, g.n_valid, g.last_at, g.days_since
  from public.pv_customer_signals(p_org, p_ref) g join public.customers c on c.id = g.customer_id
  left join public.customer_rfm_scores sc on sc.customer_id = g.customer_id and sc.run_id = run
  where (p_seller is null or c.assigned_to = p_seller) and (p_segment is null or sc.segment_key = p_segment) and (p_status is null or g.state = p_status);
end $$;

-- Compras válidas do período (do escopo; categoria filtra pelos itens).
create function private.pv_period_purchases(p_org uuid, p_from date, p_to date, p_seller uuid, p_segment text, p_category text, p_status text)
returns table (purchase_id uuid, customer_id uuid, purchased_at timestamptz, d date, net_cents bigint, is_repeat boolean)
language plpgsql stable security invoker set search_path = '' as $$
declare w record;
begin
  select * into w from private.pv_window(p_org, p_from, p_to);
  return query
  select pu.id, pu.customer_id, pu.purchased_at, (pu.purchased_at at time zone w.tz)::date, pu.net_cents,
         exists (select 1 from public.purchases b where b.customer_id = pu.customer_id and b.is_valid and b.purchased_at < pu.purchased_at)
  from public.purchases pu join private.pv_scope(p_org, w.ref, p_seller, p_segment, p_status) sc on sc.customer_id = pu.customer_id
  where pu.organization_id = p_org and pu.is_valid and pu.purchased_at >= w.t0 and pu.purchased_at < w.t1
    and (p_category is null or exists (select 1 from public.purchase_items i where i.purchase_id = pu.id and lower(i.category) = lower(p_category)));
end $$;

do $$
declare f text;
begin
  foreach f in array array['private.pv_window(uuid, date, date)', 'private.pv_scope(uuid, date, uuid, text, text)', 'private.pv_period_purchases(uuid, date, date, uuid, text, text, text)'] loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- ======================================================================= indicadores
create function public.pv_kpis(p_org uuid, p_from date, p_to date, p_seller uuid default null, p_segment text default null, p_category text default null, p_status text default null)
returns table (recent_customers bigint, at_risk bigint, inactive bigint, reactivated bigint, reactivation_cohort bigint, reactivation_cohort_done bigint, reactivation_rate numeric,
               reactivation_revenue_cents bigint, repurchase_buyers bigint, repurchase_repeat bigint, repurchase_rate numeric, orders bigint, revenue_cents bigint, avg_ticket_cents bigint, overdue_tasks bigint)
language plpgsql stable security invoker set search_path = '' as $$
#variable_conflict use_column
declare w record; obs int;
begin
  select * into w from private.pv_window(p_org, p_from, p_to);
  select s.observation_days into obs from public.pv_settings s where s.organization_id = p_org;
  obs := coalesce(obs, 30);
  return query
  with sc as (select * from private.pv_scope(p_org, w.ref, p_seller, p_segment, p_status)),
  pp as (select * from private.pv_period_purchases(p_org, p_from, p_to, p_seller, p_segment, p_category, p_status)),
  per_cust as (select pp.customer_id, count(*) as n from pp group by pp.customer_id),
  react as (
    select e.customer_id, (e.metadata ->> 'purchase_id')::uuid as pid from public.customer_lifecycle_events e join sc on sc.customer_id = e.customer_id
    where e.organization_id = p_org and e.event_type = 'reactivated' and e.occurred_at >= w.t0 and e.occurred_at < w.t1
  ),
  coh as (
    select o.customer_id, o.status, o.resolved_at, o.identified_at from public.reactivation_opportunities o join sc on sc.customer_id = o.customer_id
    where o.organization_id = p_org and o.identified_at >= w.t0 and o.identified_at < w.t1 and o.identified_at + make_interval(days => obs) <= now()
  ),
  coh_c as (select c.customer_id, bool_or(c.status = 'reactivated' and c.resolved_at <= c.identified_at + make_interval(days => obs)) as done from coh c group by c.customer_id)
  select
    (select count(*) from per_cust),
    (select count(*) from sc where sc.state = 'at_risk'),
    (select count(*) from sc where sc.state = 'inactive'),
    (select count(distinct r.customer_id) from react r),
    (select count(*) from coh_c),
    (select count(*) from coh_c where done),
    (select case when count(*) = 0 then null else round(100.0 * count(*) filter (where done) / count(*), 2) end from coh_c),
    coalesce((select sum(pu.net_cents) from public.purchases pu where pu.id in (select r.pid from react r)), 0)::bigint,
    (select count(*) from per_cust),
    (select count(*) from per_cust where n >= 2),
    (select case when count(*) = 0 then null else round(100.0 * count(*) filter (where n >= 2) / count(*), 2) end from per_cust),
    (select count(*) from pp),
    coalesce((select sum(pp.net_cents) from pp), 0)::bigint,
    (select case when count(*) = 0 then null else floor(sum(pp.net_cents)::numeric / count(*) + 0.5)::bigint end from pp),
    (select count(*) from public.customer_activities a join sc on sc.customer_id = a.customer_id where a.organization_id = p_org and a.completed_at is null and a.due_at < now());
end $$;

-- Série: dia (≤ 62 dias), semana (≤ 210) ou mês. Receita de recompra = compras de clientes que já tinham comprado antes.
create function public.pv_series(p_org uuid, p_from date, p_to date, p_seller uuid default null, p_segment text default null, p_category text default null, p_status text default null)
returns table (bucket date, granularity text, orders bigint, revenue_cents bigint, avg_ticket_cents bigint, repeat_orders bigint, repeat_revenue_cents bigint, reactivated bigint)
language plpgsql stable security invoker set search_path = '' as $$
#variable_conflict use_column
declare w record; unit text;
begin
  select * into w from private.pv_window(p_org, p_from, p_to);
  unit := case when p_to - p_from <= 62 then 'day' when p_to - p_from <= 210 then 'week' else 'month' end;
  return query
  with pp as (select * from private.pv_period_purchases(p_org, p_from, p_to, p_seller, p_segment, p_category, p_status)),
  sc as (select * from private.pv_scope(p_org, w.ref, p_seller, p_segment, p_status)),
  b as (select date_trunc(unit, pp.d::timestamp)::date as d, count(*) as n, sum(pp.net_cents)::bigint as rev, count(*) filter (where pp.is_repeat) as rn,
               coalesce(sum(pp.net_cents) filter (where pp.is_repeat), 0)::bigint as rrev from pp group by 1),
  rc as (select date_trunc(unit, (e.occurred_at at time zone w.tz)::date::timestamp)::date as d, count(distinct e.customer_id) as n from public.customer_lifecycle_events e join sc on sc.customer_id = e.customer_id
         where e.organization_id = p_org and e.event_type = 'reactivated' and e.occurred_at >= w.t0 and e.occurred_at < w.t1 group by 1),
  axis as (select generate_series(date_trunc(unit, p_from::timestamp), date_trunc(unit, p_to::timestamp), ('1 ' || unit)::interval)::date as d)
  select axis.d, unit, coalesce(b.n, 0), coalesce(b.rev, 0), case when coalesce(b.n, 0) = 0 then null else floor(b.rev::numeric / b.n + 0.5)::bigint end, coalesce(b.rn, 0), coalesce(b.rrev, 0), coalesce(rc.n, 0)
  from axis left join b on b.d = axis.d left join rc on rc.d = axis.d order by axis.d;
end $$;

create function public.pv_state_distribution(p_org uuid, p_to date, p_seller uuid default null, p_segment text default null)
returns table (state text, customers bigint)
language plpgsql stable security invoker set search_path = '' as $$
#variable_conflict use_column
declare w record;
begin
  select * into w from private.pv_window(p_org, p_to, p_to);
  return query select k.k, (select count(*) from private.pv_scope(p_org, w.ref, p_seller, p_segment, null) s where s.state = k.k)
  from (values ('active', 1), ('at_risk', 2), ('inactive', 3), ('no_purchases', 4)) k(k, o) order by k.o;
end $$;

-- Distribuição por segmento RFM de uma rodada (padrão: a mais recente).
create function public.pv_rfm_distribution(p_org uuid, p_run uuid default null, p_seller uuid default null)
returns table (segment_key text, customers bigint, monetary_cents bigint, run_id uuid, model_version integer, reference_date date, low_sample boolean)
language plpgsql stable security invoker set search_path = '' as $$
#variable_conflict use_column
declare rid uuid;
begin
  rid := coalesce(p_run, (select r.id from public.rfm_runs r where r.organization_id = p_org order by r.model_version desc limit 1));
  return query
  select s.segment_key, count(*), coalesce(sum(s.monetary_cents), 0)::bigint, rid, max(s.model_version), max(s.reference_date), (select r.low_sample from public.rfm_runs r where r.id = rid)
  from public.customer_rfm_scores s join public.customers c on c.id = s.customer_id
  where s.run_id = rid and s.organization_id = p_org and (p_seller is null or c.assigned_to = p_seller) group by s.segment_key order by 2 desc, 1;
end $$;

-- Clientes por faixa de frequência (pedidos válidos no período), entre os que compraram.
create function public.pv_frequency_bands(p_org uuid, p_from date, p_to date, p_seller uuid default null, p_segment text default null, p_category text default null, p_status text default null)
returns table (band text, ord integer, customers bigint)
language plpgsql stable security invoker set search_path = '' as $$
#variable_conflict use_column
begin
  return query
  with pc as (select pp.customer_id, count(*) as n from private.pv_period_purchases(p_org, p_from, p_to, p_seller, p_segment, p_category, p_status) pp group by pp.customer_id)
  select k.b, k.o, (select count(*) from pc where case k.o when 1 then pc.n = 1 when 2 then pc.n = 2 when 3 then pc.n between 3 and 4 else pc.n >= 5 end)
  from (values ('1 pedido', 1), ('2 pedidos', 2), ('3 a 4 pedidos', 3), ('5 ou mais', 4)) k(b, o) order by k.o;
end $$;

-- Retenção por coorte de primeira compra (mês): quantos voltaram a comprar em cada mês seguinte. Sem histórico (< 2 coortes): vazio.
create function public.pv_cohorts(p_org uuid, p_months integer default 6, p_seller uuid default null)
returns table (cohort_month date, month_offset integer, customers bigint, cohort_size bigint)
language plpgsql stable security invoker set search_path = '' as $$
#variable_conflict use_column
declare tz text := private.pv_tz(p_org); cur date := date_trunc('month', (now() at time zone private.pv_tz(p_org)))::date; n int;
begin
  if p_months not between 2 and 12 then raise exception 'meses inválidos' using errcode = '22023'; end if;
  return query
  with p as (
    select pu.customer_id, date_trunc('month', (pu.purchased_at at time zone tz))::date as m from public.purchases pu join public.customers c on c.id = pu.customer_id
    where pu.organization_id = p_org and pu.is_valid and (p_seller is null or c.assigned_to = p_seller) group by 1, 2
  ), f as (select p.customer_id, min(p.m) as first_m from p group by 1),
  coh as (select f.first_m, count(*) as size from f where f.first_m > (cur - make_interval(months => p_months)) group by 1),
  ret as (select f.first_m, ((extract(year from p.m) - extract(year from f.first_m)) * 12 + extract(month from p.m) - extract(month from f.first_m))::int as k, count(distinct p.customer_id) as c
          from f join p on p.customer_id = f.customer_id where f.first_m > (cur - make_interval(months => p_months)) group by 1, 2)
  select coh.first_m, ret.k, ret.c, coh.size from coh join ret on ret.first_m = coh.first_m
  where (select count(*) from coh) >= 2 and (cur - coh.first_m) >= 0 and ret.k <= ((extract(year from cur) - extract(year from coh.first_m)) * 12 + extract(month from cur) - extract(month from coh.first_m))::int
  order by 1, 2;
end $$;

-- Desempenho por responsável: atividades concluídas, contatos de campanha e reativações dos clientes dele.
create function public.pv_seller_ranking(p_org uuid, p_from date, p_to date)
returns table (seller_id uuid, customers bigint, activities_done bigint, contacts bigint, reactivated bigint, reactivation_revenue_cents bigint)
language plpgsql stable security invoker set search_path = '' as $$
#variable_conflict use_column
declare w record;
begin
  select * into w from private.pv_window(p_org, p_from, p_to);
  return query
  with cu as (select c.id, c.assigned_to from public.customers c where c.organization_id = p_org and c.archived_at is null),
  ev as (select e.customer_id, (e.metadata ->> 'purchase_id')::uuid as pid from public.customer_lifecycle_events e
         where e.organization_id = p_org and e.event_type = 'reactivated' and e.occurred_at >= w.t0 and e.occurred_at < w.t1)
  select cu.assigned_to, count(distinct cu.id),
    (select count(*) from public.customer_activities a where a.customer_id in (select x.id from cu x where x.assigned_to is not distinct from cu.assigned_to) and a.completed_at >= w.t0 and a.completed_at < w.t1),
    (select count(*) from public.campaign_contacts k where k.customer_id in (select x.id from cu x where x.assigned_to is not distinct from cu.assigned_to) and k.contacted_at >= w.t0 and k.contacted_at < w.t1),
    (select count(distinct ev.customer_id) from ev where ev.customer_id in (select x.id from cu x where x.assigned_to is not distinct from cu.assigned_to)),
    coalesce((select sum(pu.net_cents) from public.purchases pu where pu.id in (select ev.pid from ev where ev.customer_id in (select x.id from cu x where x.assigned_to is not distinct from cu.assigned_to))), 0)::bigint
  from cu group by cu.assigned_to order by 4 desc, 3 desc;
end $$;

-- ======================================================================= campanhas
create function public.pv_campaign_stats(p_org uuid, p_from date, p_to date)
returns table (campaign_id uuid, name text, status public.pv_campaign_status, channel public.pv_channel, eligible bigint, excluded bigint, contacted bigint, responded bigint, response_rate numeric,
               rebought bigint, rebought_value_cents bigint, pending_tasks bigint, created_at timestamptz)
language plpgsql stable security invoker set search_path = '' as $$
#variable_conflict use_column
declare w record;
begin
  select * into w from private.pv_window(p_org, p_from, p_to);
  return query
  select c.id, c.name, c.status, c.channel,
    (select count(*) from public.campaign_memberships m where m.campaign_id = c.id and m.status <> 'excluded'),
    (select count(*) from public.campaign_memberships m where m.campaign_id = c.id and m.status = 'excluded'),
    (select count(distinct k.customer_id) from public.campaign_contacts k where k.campaign_id = c.id and k.contact_status <> 'planned'),
    (select count(distinct k.customer_id) from public.campaign_contacts k where k.campaign_id = c.id and k.contact_status = 'responded'),
    (select case when count(distinct k.customer_id) = 0 then null else round(100.0 * count(distinct k.customer_id) filter (where k.contact_status = 'responded') / count(distinct k.customer_id), 2) end
       from public.campaign_contacts k where k.campaign_id = c.id and k.contact_status <> 'planned'),
    (select count(distinct o.customer_id) from public.campaign_outcomes o where o.campaign_id = c.id),
    coalesce((select sum(pu.net_cents) from public.campaign_outcomes o join public.purchases pu on pu.id = o.related_purchase_id where o.campaign_id = c.id), 0)::bigint,
    (select count(*) from public.customer_activities a where a.campaign_id = c.id and a.completed_at is null),
    c.created_at
  -- campanhas «vivas» no período: em andamento/pausadas desde antes; rascunhos e planejadas só se criadas nele; encerradas se terminaram nele ou depois
  from public.campaigns c where c.organization_id = p_org and c.created_at < w.t1
    and coalesce(c.completed_at, case when c.status in ('running', 'paused') then 'infinity'::timestamptz else c.created_at end) >= w.t0
  order by c.created_at desc;
end $$;

create function public.pv_campaign_series(p_org uuid, p_from date, p_to date)
returns table (bucket date, granularity text, contacts bigint, responses bigint, rebuys bigint)
language plpgsql stable security invoker set search_path = '' as $$
#variable_conflict use_column
declare w record; unit text;
begin
  select * into w from private.pv_window(p_org, p_from, p_to);
  unit := case when p_to - p_from <= 62 then 'day' when p_to - p_from <= 210 then 'week' else 'month' end;
  return query
  with k as (select date_trunc(unit, (ct.contacted_at at time zone w.tz)::date::timestamp)::date as d, count(*) as n, count(*) filter (where ct.contact_status = 'responded') as r
             from public.campaign_contacts ct where ct.organization_id = p_org and ct.contacted_at >= w.t0 and ct.contacted_at < w.t1 and ct.contact_status <> 'planned' group by 1),
  o as (select date_trunc(unit, (x.outcome_at at time zone w.tz)::date::timestamp)::date as d, count(*) as n from public.campaign_outcomes x where x.organization_id = p_org and x.outcome_at >= w.t0 and x.outcome_at < w.t1 group by 1),
  axis as (select generate_series(date_trunc(unit, p_from::timestamp), date_trunc(unit, p_to::timestamp), ('1 ' || unit)::interval)::date as d)
  select axis.d, unit, coalesce(k.n, 0), coalesce(k.r, 0), coalesce(o.n, 0) from axis left join k on k.d = axis.d left join o on o.d = axis.d order by axis.d;
end $$;

-- Alertas (agora).
create function public.pv_alerts(p_org uuid) returns table (key text, customers bigint)
language plpgsql stable security invoker set search_path = '' as $$
declare s public.pv_settings%rowtype; ref date;
begin
  select * into s from public.pv_settings where organization_id = p_org;
  if not found then raise exception 'organização sem configuração' using errcode = 'P0002'; end if;
  ref := private.pv_today(p_org);
  return query
  select 'overdue_tasks', (select count(distinct a.customer_id) from public.customer_activities a where a.organization_id = p_org and a.completed_at is null and a.due_at < now())
  union all select 'high_priority_open', (select count(*) from public.reactivation_opportunities o where o.organization_id = p_org and o.status = 'open' and o.priority >= s.priority_high)
  union all select 'near_cycle', (select count(*) from public.pv_customer_signals(p_org, ref) g where g.n_valid >= s.cycle_min_purchases and g.median_interval is not null and g.state = 'active'
        and g.days_since >= 0.8 * s.cycle_factor * greatest(g.median_interval, 1) and g.days_since >= s.cycle_min_days)
  union all select 'no_contact_open', (select count(*) from public.reactivation_opportunities o where o.organization_id = p_org and o.status = 'open' and o.last_contact_at is null and o.identified_at < now() - interval '7 days');
end $$;

create function public.pv_user_labels(p_org uuid) returns table (user_id uuid, label text)
language sql stable security definer set search_path = '' as $$
  select m.user_id, coalesce(nullif(p.full_name, ''), nullif(split_part(p.email, '@', 1), ''), 'Usuário')
  from public.organization_members m left join public.profiles p on p.id = m.user_id where m.organization_id = p_org and private.is_member(p_org);
$$;

-- Exportação de CSV deixa rastro na auditoria (quem, qual relatório, quantas linhas; nunca os dados). Só gestão, e com MFA quando exigido.
create function public.pv_log_export(p_org uuid, p_kind text, p_rows integer) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.pv_is_manager(p_org) or not private.mfa_ok() then raise exception 'sem permissão' using errcode = '42501'; end if;
  if p_kind is null or p_kind !~ '^[a-z0-9-]{2,40}$' then raise exception 'relatório inválido' using errcode = '22023'; end if;
  insert into public.audit_log (organization_id, actor_id, action, entity, entity_id, changes)
  values (p_org, (select auth.uid()), 'export', 'report', p_kind, jsonb_build_object('rows', greatest(coalesce(p_rows, 0), 0)));
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.pv_log_export(uuid, text, integer)', 'public.pv_kpis(uuid, date, date, uuid, text, text, text)', 'public.pv_series(uuid, date, date, uuid, text, text, text)', 'public.pv_state_distribution(uuid, date, uuid, text)',
    'public.pv_rfm_distribution(uuid, uuid, uuid)', 'public.pv_frequency_bands(uuid, date, date, uuid, text, text, text)', 'public.pv_cohorts(uuid, integer, uuid)', 'public.pv_seller_ranking(uuid, date, date)',
    'public.pv_campaign_stats(uuid, date, date)', 'public.pv_campaign_series(uuid, date, date)', 'public.pv_alerts(uuid)', 'public.pv_user_labels(uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

commit;
