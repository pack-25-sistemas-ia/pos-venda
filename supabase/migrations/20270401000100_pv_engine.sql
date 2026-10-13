-- Pós-Venda e Reativação — MOTOR (parte 2): RFM, sinais de risco, oportunidades, segmentos dinâmicos.
-- Metodologia: docs/RFM_MODEL.md. Funções puras são testadas com fixtures calculadas à mão.

begin;

-- ======================================================================= utilitários
create function private.pv_assert_manager(org uuid) returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.pv_is_manager(org) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if not private.mfa_ok() then raise exception 'verificação em duas etapas necessária' using errcode = '42501'; end if;
end $$;
create function private.pv_assert_admin(org uuid) returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.pv_is_admin(org) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if not private.mfa_ok() then raise exception 'verificação em duas etapas necessária' using errcode = '42501'; end if;
end $$;
create function private.pv_tz(org uuid) returns text language plpgsql stable security definer set search_path = '' as $$
declare v text;
begin
  select timezone into v from public.pv_settings where organization_id = org;
  v := coalesce(v, 'America/Sao_Paulo');
  if not exists (select 1 from pg_timezone_names n where n.name = v) then v := 'America/Sao_Paulo'; end if;
  return v;
end $$;
create function private.pv_today(org uuid) returns date language sql stable security definer set search_path = '' as $$
  select (now() at time zone private.pv_tz(org))::date;
$$;
create function private.pv_notify(org uuid, usr uuid, p_type text, p_title text, p_body text, p_link text, p_key text) returns void
language sql security definer set search_path = '' as $$
  insert into public.notifications (organization_id, user_id, type, title, body, link, dedup_key)
  select org, usr, p_type, left(p_title, 160), left(p_body, 600), p_link, p_key
  where exists (select 1 from public.organization_members m where m.organization_id = org and m.user_id = usr)
  on conflict (user_id, dedup_key) where dedup_key is not null do nothing;
$$;
-- Avisa a quem cuida do cliente (responsável) ou, sem responsável, a gestão.
create function private.pv_notify_customer(org uuid, cust uuid, p_type text, p_title text, p_body text, p_link text, p_key text) returns void
language plpgsql security definer set search_path = '' as $$
declare a uuid; r record;
begin
  select assigned_to into a from public.customers where id = cust;
  if a is not null then perform private.pv_notify(org, a, p_type, p_title, p_body, p_link, p_key); return; end if;
  for r in select user_id from public.organization_members where organization_id = org and role in ('owner', 'admin', 'manager') loop
    perform private.pv_notify(org, r.user_id, p_type, p_title, p_body, p_link, p_key);
  end loop;
end $$;
do $$
declare f text;
begin
  foreach f in array array['private.pv_assert_manager(uuid)', 'private.pv_assert_admin(uuid)', 'private.pv_tz(uuid)', 'private.pv_today(uuid)',
    'private.pv_notify(uuid, uuid, text, text, text, text, text)', 'private.pv_notify_customer(uuid, uuid, text, text, text, text, text)'] loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- ======================================================================= RFM — funções PURAS
-- Nota 1–5 por limites fixos. Recência: menor é melhor (limites crescentes em dias). F e M: maior é melhor.
create function public.pv_score_fixed(v numeric, lim jsonb, higher_better boolean) returns integer
language plpgsql immutable set search_path = '' as $$
declare a numeric := (lim ->> 0)::numeric; b numeric := (lim ->> 1)::numeric; c numeric := (lim ->> 2)::numeric; d numeric := (lim ->> 3)::numeric;
begin
  if v is null then return null; end if;
  if higher_better then
    return case when v >= d then 5 when v >= c then 4 when v >= b then 3 when v >= a then 2 else 1 end;
  end if;
  return case when v <= a then 5 when v <= b then 4 when v <= c then 3 when v <= d then 2 else 1 end;
end $$;

-- Notas para um conjunto: [{id,r,f,m}] -> [{id,r_score,f_score,m_score}] (percentil por percent_rank, ou limites fixos).
create function public.pv_rfm_scores(p_rows jsonb, p_mode text, p_limits jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
begin
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'linhas inválidas' using errcode = '22023'; end if;
  if p_mode not in ('percentile', 'fixed') then raise exception 'modo inválido' using errcode = '22023'; end if;
  if p_mode = 'fixed' then
    return coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'r_score', public.pv_score_fixed(x.r, p_limits -> 'r', false),
              'f_score', public.pv_score_fixed(x.f, p_limits -> 'f', true), 'm_score', public.pv_score_fixed(x.m, p_limits -> 'm', true)) order by x.id)
            from jsonb_to_recordset(p_rows) as x(id text, r numeric, f numeric, m numeric)), '[]'::jsonb);
  end if;
  return coalesce((
    with x as (select * from jsonb_to_recordset(p_rows) as t(id text, r numeric, f numeric, m numeric)),
    p as (select id, count(*) over () as n, rank() over (order by r) - 1 as br, rank() over (order by f) - 1 as bf, rank() over (order by m) - 1 as bm from x)
    select jsonb_agg(jsonb_build_object('id', id,
      'r_score', case when n <= 1 then 5 else least(5, 1 + (5 * (n - 1 - br)) / (n - 1)) end::int,
      'f_score', case when n <= 1 then 1 else least(5, 1 + (5 * bf) / (n - 1)) end::int,
      'm_score', case when n <= 1 then 1 else least(5, 1 + (5 * bm) / (n - 1)) end::int) order by id) from p), '[]'::jsonb);
end $$;

-- Segmento pela regra documentada (primeira que servir).
create function public.pv_rfm_classify(r int, f int, m int, frequency int, first_days int, new_days int) returns text
language sql immutable set search_path = '' as $$
  select case
    when r >= 4 and f >= 4 and m >= 4 then 'campeoes'
    when r >= 3 and f >= 3 then 'fieis'
    when frequency = 1 and first_days <= new_days then 'novos'
    when r >= 4 then 'promissores'
    when r <= 2 and (f >= 3 or m >= 3) then 'em_risco'
    else 'atencao' end;
$$;

-- ======================================================================= sinais por cliente (estado e regras de risco)
-- security INVOKER: o RLS limita ao que o usuário enxerga. p_ref = data de referência (compras depois dela são ignoradas).
create function public.pv_customer_signals(p_org uuid, p_ref date)
returns table (customer_id uuid, n_valid integer, first_at date, last_at date, days_since integer, net_total_cents bigint, median_interval numeric, median_ticket_cents bigint,
               orders_recent integer, orders_prev integer, state text, signals text[])
language plpgsql stable security invoker set search_path = '' as $$
declare s public.pv_settings%rowtype; tz text;
begin
  select * into s from public.pv_settings where organization_id = p_org;
  if not found then raise exception 'organização sem configuração' using errcode = 'P0002'; end if;
  tz := private.pv_tz(p_org);
  return query
  with p as (
    select pu.customer_id, (pu.purchased_at at time zone tz)::date as d, pu.net_cents, pu.purchased_at
    from public.purchases pu where pu.organization_id = p_org and pu.is_valid and (pu.purchased_at at time zone tz)::date <= p_ref
  ), iv as (
    select p.customer_id, p.d, p.net_cents, p.d - lag(p.d) over (partition by p.customer_id order by p.d, p.purchased_at) as gap from p
  ), agg as (
    select iv.customer_id, count(*)::int as n, min(iv.d) as first_at, max(iv.d) as last_at, sum(iv.net_cents)::bigint as total,
           (percentile_cont(0.5) within group (order by iv.gap) filter (where iv.gap is not null))::numeric as med_gap,
           round(percentile_cont(0.5) within group (order by iv.net_cents))::bigint as med_ticket,
           count(*) filter (where iv.d > p_ref - s.drop_window_days)::int as o_recent,
           count(*) filter (where iv.d > p_ref - 2 * s.drop_window_days and iv.d <= p_ref - s.drop_window_days)::int as o_prev
    from iv group by iv.customer_id
  ), base as (
    select c.id as cid, coalesce(a.n, 0) as n, a.first_at, a.last_at, case when a.last_at is null then null else p_ref - a.last_at end as ds, coalesce(a.total, 0)::bigint as total,
           a.med_gap, a.med_ticket, coalesce(a.o_recent, 0) as o_recent, coalesce(a.o_prev, 0) as o_prev
    from public.customers c left join agg a on a.customer_id = c.id
    where c.organization_id = p_org and c.archived_at is null
  ), sig as (
    select b.*, array_remove(array[
      case when s.rule_inactivity and b.ds is not null and b.ds >= s.risk_days then 'inactivity' end,
      case when s.rule_cycle and b.n >= s.cycle_min_purchases and b.med_gap is not null and b.ds > s.cycle_factor * greatest(b.med_gap, 1) and b.ds >= s.cycle_min_days then 'cycle' end,
      case when s.rule_drop and b.o_prev >= s.drop_min_prev and b.o_recent <= b.o_prev * (1 - s.drop_pct / 100.0) and b.n > 0 then 'frequency_drop' end
    ], null) as sg from base b
  )
  select sig.cid, sig.n, sig.first_at, sig.last_at, sig.ds, sig.total, sig.med_gap, sig.med_ticket, sig.o_recent, sig.o_prev,
         case when sig.n = 0 then 'no_purchases' when sig.ds >= s.inactive_days then 'inactive' when cardinality(sig.sg) > 0 then 'at_risk' else 'active' end,
         sig.sg
  from sig;
end $$;

-- ======================================================================= rodada RFM (histórico imutável)
create function public.pv_rfm_run(p_org uuid, p_ref date default null, p_window integer default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare s public.pv_settings%rowtype; tz text; ref date; win int; rid uuid := gen_random_uuid(); ver int; n_scored int; prev uuid; low boolean;
begin
  perform private.pv_assert_manager(p_org);
  select * into s from public.pv_settings where organization_id = p_org;
  tz := private.pv_tz(p_org);
  ref := coalesce(p_ref, private.pv_today(p_org));
  win := coalesce(p_window, s.rfm_window_days);
  if win not between 30 and 1095 then raise exception 'janela inválida (30 a 1095 dias)' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('pv_rfm:' || p_org::text, 0));
  select id into prev from public.rfm_runs where organization_id = p_org order by model_version desc limit 1;
  select coalesce(max(model_version), 0) + 1 into ver from public.rfm_runs where organization_id = p_org;

  create temp table pv_rfm_tmp on commit drop as
  with p as (
    select pu.customer_id, (pu.purchased_at at time zone tz)::date as d, pu.net_cents from public.purchases pu
    where pu.organization_id = p_org and pu.is_valid and (pu.purchased_at at time zone tz)::date <= ref
  ), w as (
    select customer_id, (ref - max(d))::int as r, count(*)::int as f, sum(net_cents)::bigint as m from p where d > ref - win group by customer_id
  ), life as (
    select customer_id, min(d) as first_d, count(*) as n_all from p group by customer_id
  )
  select c.id as customer_id, w.r, w.f, w.m, (ref - l.first_d)::int as first_days, l.n_all, (w.r is not null) as scored
  from public.customers c left join w on w.customer_id = c.id left join life l on l.customer_id = c.id
  where c.organization_id = p_org and c.archived_at is null;

  select count(*) into n_scored from pv_rfm_tmp t where t.scored;
  low := n_scored < 5;
  insert into public.rfm_runs (id, organization_id, model_version, reference_date, window_days, mode, params_json, scored_count, low_sample)
  values (rid, p_org, ver, ref, win, s.rfm_mode, jsonb_build_object('limits', s.rfm_limits, 'new_customer_days', s.new_customer_days, 'window_days', win), n_scored, low);

  create temp table pv_scores_tmp on commit drop as
    select e ->> 'id' as id, (e ->> 'r_score')::int as r_score, (e ->> 'f_score')::int as f_score, (e ->> 'm_score')::int as m_score
    from jsonb_array_elements(coalesce(public.pv_rfm_scores((select jsonb_agg(jsonb_build_object('id', customer_id::text, 'r', r, 'f', f, 'm', m)) from pv_rfm_tmp where scored), s.rfm_mode, s.rfm_limits), '[]'::jsonb)) e;
  insert into public.customer_rfm_scores (organization_id, run_id, customer_id, model_version, reference_date, recency_days, frequency, monetary_cents, r_score, f_score, m_score, segment_key)
  select p_org, rid, t.customer_id, ver, ref, t.r, t.f, t.m, sc.r_score, sc.f_score, sc.m_score,
         case when not t.scored then (case when coalesce(t.n_all, 0) > 0 then 'inativos' else 'sem_compras' end)
              else public.pv_rfm_classify(sc.r_score, sc.f_score, sc.m_score, t.f, t.first_days, s.new_customer_days) end
  from pv_rfm_tmp t left join pv_scores_tmp sc on sc.id = t.customer_id::text;
  drop table pv_scores_tmp;
  drop table pv_rfm_tmp;

  -- mudanças de segmento em relação à rodada anterior (idempotente por chave)
  if prev is not null then
    insert into public.customer_lifecycle_events (organization_id, customer_id, event_type, event_key, metadata, occurred_at)
    select p_org, n.customer_id, 'segment_changed', 'seg:' || rid || ':' || n.customer_id, jsonb_build_object('from', o.segment_key, 'to', n.segment_key, 'run', rid), now()
    from public.customer_rfm_scores n join public.customer_rfm_scores o on o.run_id = prev and o.customer_id = n.customer_id
    where n.run_id = rid and n.segment_key <> o.segment_key
    on conflict do nothing;
  end if;
  return rid;
end $$;

-- ======================================================================= oportunidades de reativação
-- Reativação: o cliente tinha oportunidade aberta (risco/inatividade) e fez uma compra válida DEPOIS de identificada. Compra guarda o DIA (sem hora):
-- vale a data no fuso da organização, a partir do dia da identificação (quem já comprou antes nem teria sido identificado).
create function private.pv_detect_reactivations(p_org uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0; pid uuid; pat timestamptz; pnet bigint; tz text := private.pv_tz(p_org);
begin
  for r in select o.id, o.customer_id, o.reason, o.identified_at from public.reactivation_opportunities o where o.organization_id = p_org and o.status in ('open', 'in_progress') loop
    select pu.id, pu.purchased_at, pu.net_cents into pid, pat, pnet from public.purchases pu
      where pu.customer_id = r.customer_id and pu.is_valid and (pu.purchased_at at time zone tz)::date >= (r.identified_at at time zone tz)::date order by pu.purchased_at limit 1;
    if pid is null then continue; end if;
    update public.reactivation_opportunities set status = 'reactivated', resolved_at = pat, reactivated_purchase_id = pid where id = r.id;
    insert into public.customer_lifecycle_events (organization_id, customer_id, event_type, event_key, metadata, occurred_at)
    values (p_org, r.customer_id, 'reactivated', 'react:' || r.customer_id || ':' || pid, jsonb_build_object('purchase_id', pid, 'net_cents', pnet, 'reason', r.reason, 'opportunity_id', r.id), pat)
    on conflict do nothing;
    if found then
      perform private.pv_notify_customer(p_org, r.customer_id, 'reactivated', 'Cliente recomprou', 'Um cliente com oportunidade de reativação fez uma nova compra.', '/clientes/' || r.customer_id, 'react:' || r.customer_id || ':' || pid);
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function private.pv_detect_reactivations(uuid) from public;

-- Resultado de campanha: recompra observada após o PRIMEIRO contato registrado, dentro da janela da campanha. A compra guarda só o DIA:
-- conta quem comprou em um dia POSTERIOR ao do primeiro contato (compra do mesmo dia é ambígua e não é contada, para não prometer o que não se sabe).
create function private.pv_campaign_sync(p_campaign uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare c public.campaigns%rowtype; n int; tz text;
begin
  select * into c from public.campaigns where id = p_campaign;
  if not found or c.status in ('draft', 'planned') then return 0; end if;
  tz := private.pv_tz(c.organization_id);
  insert into public.campaign_outcomes (organization_id, campaign_id, customer_id, outcome_type, related_purchase_id, outcome_at)
  select c.organization_id, c.id, k.customer_id, 'rebought', pu.id, pu.purchased_at
  from (select ct.customer_id, min(ct.contacted_at) as first_contact from public.campaign_contacts ct
          where ct.campaign_id = c.id and ct.contact_status in ('contacted', 'responded') and ct.contacted_at is not null group by ct.customer_id) k
  join public.purchases pu on pu.customer_id = k.customer_id and pu.is_valid
     and (pu.purchased_at at time zone tz)::date > (k.first_contact at time zone tz)::date and (pu.purchased_at at time zone tz)::date <= (k.first_contact at time zone tz)::date + c.observation_days
  on conflict do nothing;
  get diagnostics n = row_count;
  update public.campaign_memberships m set status = 'rebought'
   where m.campaign_id = c.id and m.status in ('contacted', 'responded', 'no_response', 'refused', 'assigned', 'eligible')
     and exists (select 1 from public.campaign_outcomes o where o.campaign_id = c.id and o.customer_id = m.customer_id);
  return n;
end $$;
revoke all on function private.pv_campaign_sync(uuid) from public;

create function public.pv_refresh(p_org uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.pv_settings%rowtype; ref date; created int := 0; closed int := 0; react int; r record; ncamp int := 0; prio int; refd numeric; run uuid; prev uuid; ovd int := 0;
begin
  perform private.pv_assert_manager(p_org);
  perform pg_advisory_xact_lock(hashtextextended('pv_refresh:' || p_org::text, 0));
  select * into s from public.pv_settings where organization_id = p_org;
  ref := private.pv_today(p_org);
  -- 1) recompras já reconhecem oportunidades abertas
  react := private.pv_detect_reactivations(p_org);
  -- 2) oportunidades por regra
  create temp table pv_sig_tmp on commit drop as select * from public.pv_customer_signals(p_org, ref);
  create temp table pv_pct_tmp on commit drop as
    select customer_id, percent_rank() over (order by net_total_cents) as pm, percent_rank() over (order by n_valid) as pf from pv_sig_tmp where n_valid > 0;
  for r in
    select g.customer_id, reason, g.n_valid, g.days_since, g.median_interval, g.median_ticket_cents, g.orders_recent, g.orders_prev, g.last_at, coalesce(pc.pm, 0) as pm, coalesce(pc.pf, 0) as pf, g.state
    from pv_sig_tmp g left join pv_pct_tmp pc on pc.customer_id = g.customer_id, unnest(g.signals) as reason
    where g.n_valid > 0 and g.state in ('at_risk', 'inactive')
  loop
    refd := case r.reason when 'cycle' then s.cycle_factor * greatest(coalesce(r.median_interval, 1), 1) when 'frequency_drop' then s.drop_window_days else s.inactive_days end;
    prio := round((s.w_value * r.pm + s.w_frequency * r.pf + s.w_overdue * least(1, r.days_since / greatest(refd, 1))) / (s.w_value + s.w_frequency + s.w_overdue) * 100);
    insert into public.reactivation_opportunities (organization_id, customer_id, reason, priority, estimated_value_cents, explanation_json, assigned_to)
    select p_org, r.customer_id, r.reason::public.pv_opp_reason, prio, case when r.n_valid >= 3 then r.median_ticket_cents end,
           jsonb_build_object('days_since_last', r.days_since, 'purchases', r.n_valid, 'median_interval_days', r.median_interval, 'orders_recent', r.orders_recent, 'orders_previous', r.orders_prev,
                              'last_purchase', r.last_at, 'reference_days', round(refd, 1), 'value_percentile', round(r.pm * 100)::int, 'frequency_percentile', round(r.pf * 100)::int, 'state', r.state, 'ticket_basis', case when r.n_valid >= 3 then 'ticket mediano histórico' else null end),
           (select assigned_to from public.customers where id = r.customer_id)
    on conflict (organization_id, customer_id, reason) where status in ('open', 'in_progress')
      do update set priority = excluded.priority, estimated_value_cents = excluded.estimated_value_cents, explanation_json = excluded.explanation_json;
    if found then created := created + 1; end if;
  end loop;
  -- mudança de segmento (fiéis/campeões que caíram), quando a regra está ativa e há rodada anterior
  if s.rule_segment_change then
    select id into run from public.rfm_runs where organization_id = p_org order by model_version desc limit 1;
    select id into prev from public.rfm_runs where organization_id = p_org and id <> run order by model_version desc limit 1;
    if prev is not null then
      insert into public.reactivation_opportunities (organization_id, customer_id, reason, priority, explanation_json, assigned_to)
      select p_org, n.customer_id, 'segment_change', coalesce(round(coalesce(pc.pm, 0) * 60 + coalesce(pc.pf, 0) * 40), 0)::int,
             jsonb_build_object('from_segment', o.segment_key, 'to_segment', n.segment_key, 'run', run, 'previous_run', prev, 'reference_days', s.risk_days),
             (select assigned_to from public.customers where id = n.customer_id)
      from public.customer_rfm_scores n join public.customer_rfm_scores o on o.run_id = prev and o.customer_id = n.customer_id
      left join pv_pct_tmp pc on pc.customer_id = n.customer_id
      where n.run_id = run and o.segment_key in ('campeoes', 'fieis') and n.segment_key in ('em_risco', 'atencao', 'inativos')
      on conflict (organization_id, customer_id, reason) where status in ('open', 'in_progress') do nothing;
    end if;
  end if;
  -- 3) fecha oportunidades «abertas» cuja regra deixou de valer (ex.: parâmetros mudaram) — nunca as já trabalhadas
  update public.reactivation_opportunities o set status = 'discarded', resolved_at = now(), discard_reason = 'A regra deixou de se aplicar.'
   where o.organization_id = p_org and o.status = 'open' and o.reason <> 'segment_change'
     and not exists (select 1 from pv_sig_tmp g where g.customer_id = o.customer_id and o.reason::text = any (g.signals));
  get diagnostics closed = row_count;
  -- 4) eventos de ciclo de vida: entrada em risco/inatividade (uma vez por última compra)
  insert into public.customer_lifecycle_events (organization_id, customer_id, event_type, event_key, metadata)
  select p_org, g.customer_id, case when g.state = 'inactive' then 'inactive' else 'at_risk' end, g.state || ':' || g.customer_id || ':' || g.last_at,
         jsonb_build_object('days_since_last', g.days_since, 'signals', g.signals)
  from pv_sig_tmp g where g.state in ('at_risk', 'inactive') on conflict do nothing;
  -- 5) resultados de campanhas e notificações
  for r in select id from public.campaigns where organization_id = p_org and status in ('running', 'paused', 'completed') loop
    ncamp := ncamp + private.pv_campaign_sync(r.id);
  end loop;
  if s.alert_overdue_tasks then
    for r in select a.id, a.customer_id, coalesce(a.assigned_to, a.user_id) as who from public.customer_activities a
              where a.organization_id = p_org and a.completed_at is null and a.due_at < now() loop
      if r.who is not null then perform private.pv_notify(p_org, r.who, 'task_overdue', 'Tarefa vencida', 'Há uma tarefa de cliente vencida e não concluída.', '/atividades', 'overdue:' || r.id); ovd := ovd + 1; end if;
    end loop;
  end if;
  for r in select user_id from public.organization_members where organization_id = p_org and role in ('owner', 'admin', 'manager') loop
    if created > 0 then perform private.pv_notify(p_org, r.user_id, 'new_opportunities', 'Novas oportunidades de reativação', created || ' oportunidade(s) criada(s) ou atualizada(s).', '/reativacao', 'opps:' || ref || ':' || r.user_id); end if;
  end loop;
  drop table pv_sig_tmp; drop table pv_pct_tmp;
  return jsonb_build_object('reference_date', ref, 'opportunities_touched', created, 'opportunities_closed', closed, 'reactivated', react, 'campaign_outcomes', ncamp);
end $$;

-- Ações sobre uma oportunidade (atribuir, iniciar, descartar, próxima ação, confirmar reativação com evidência).
create function public.pv_opp_action(p_opp uuid, p_action text, p_value text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare o public.reactivation_opportunities%rowtype; c public.customers%rowtype; pid uuid; pat timestamptz;
begin
  select * into o from public.reactivation_opportunities where id = p_opp for update;
  if not found then raise exception 'oportunidade não encontrada' using errcode = 'P0002'; end if;
  select * into c from public.customers where id = o.customer_id;
  if not private.pv_can_write(o.organization_id, c.assigned_to) or not private.mfa_ok() then raise exception 'sem permissão' using errcode = '42501'; end if;
  if o.status in ('reactivated', 'discarded') then raise exception 'oportunidade já encerrada' using errcode = '23514'; end if;
  case p_action
    when 'start' then update public.reactivation_opportunities set status = 'in_progress' where id = p_opp;
    when 'next_action' then update public.reactivation_opportunities set next_action = nullif(left(btrim(coalesce(p_value, '')), 300), '') where id = p_opp;
    when 'assign' then
      perform private.pv_assert_manager(o.organization_id);
      if p_value is not null and not exists (select 1 from public.organization_members m where m.organization_id = o.organization_id and m.user_id = p_value::uuid and m.role <> 'viewer') then raise exception 'responsável inválido' using errcode = '22023'; end if;
      update public.reactivation_opportunities set assigned_to = nullif(p_value, '')::uuid where id = p_opp;
    when 'discard' then
      if nullif(btrim(coalesce(p_value, '')), '') is null then raise exception 'informe o motivo do descarte' using errcode = '23514'; end if;
      update public.reactivation_opportunities set status = 'discarded', resolved_at = now(), discard_reason = left(btrim(p_value), 300) where id = p_opp;
    when 'reactivated' then
      select pu.id, pu.purchased_at into pid, pat from public.purchases pu where pu.customer_id = o.customer_id and pu.is_valid and (pu.purchased_at at time zone private.pv_tz(o.organization_id))::date >= (o.identified_at at time zone private.pv_tz(o.organization_id))::date order by pu.purchased_at limit 1;
      if pid is null then raise exception 'não há compra válida depois da identificação: sem evidência de reativação' using errcode = '23514'; end if;
      perform private.pv_detect_reactivations(o.organization_id);
    else raise exception 'ação inválida' using errcode = '22023';
  end case;
end $$;

-- ======================================================================= segmentos dinâmicos (sem SQL livre)
-- Critérios: {"match":"all"|"any","conditions":[{field,op,value}]}. Lista fechada de campos e operadores; valores tipados e escapados.
create function public.pv_validate_criteria(p_criteria jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare errs jsonb := '[]'::jsonb; c jsonb; f text; o text; v jsonb; n int := 0;
begin
  if jsonb_typeof(p_criteria) <> 'object' or coalesce(p_criteria ->> 'match', 'all') not in ('all', 'any') or jsonb_typeof(p_criteria -> 'conditions') <> 'array' then
    return jsonb_build_array('Critérios inválidos.');
  end if;
  if jsonb_array_length(p_criteria -> 'conditions') = 0 then errs := errs || to_jsonb('Adicione ao menos uma condição.'::text); end if;
  if jsonb_array_length(p_criteria -> 'conditions') > 10 then errs := errs || to_jsonb('No máximo 10 condições.'::text); end if;
  for c in select value from jsonb_array_elements(p_criteria -> 'conditions') loop
    n := n + 1; f := c ->> 'field'; o := c ->> 'op'; v := c -> 'value';
    if f in ('days_since_last', 'total_spent_cents', 'purchases_count') then
      if o not in ('gt', 'gte', 'lt', 'lte', 'eq') or jsonb_typeof(v) <> 'number' or abs((v #>> '{}')::numeric) > 1e12 then errs := errs || to_jsonb(format('Condição %s: use um número e um operador numérico.', n)); end if;
    elsif f = 'last_purchase_date' then
      if o not in ('gt', 'gte', 'lt', 'lte') or jsonb_typeof(v) <> 'string' or (v #>> '{}') !~ '^\d{4}-\d{2}-\d{2}$' then errs := errs || to_jsonb(format('Condição %s: informe uma data AAAA-MM-DD.', n)); end if;
    elsif f = 'rfm_segment' then
      if o not in ('in', 'not_in') or jsonb_typeof(v) <> 'array' or jsonb_array_length(v) = 0 or exists (select 1 from jsonb_array_elements_text(v) e where e not in ('campeoes', 'fieis', 'novos', 'promissores', 'em_risco', 'atencao', 'inativos', 'sem_compras')) then
        errs := errs || to_jsonb(format('Condição %s: escolha segmentos RFM válidos.', n)); end if;
    elsif f = 'state' then
      if o not in ('eq', 'in') or (o = 'eq' and (jsonb_typeof(v) <> 'string' or (v #>> '{}') not in ('active', 'at_risk', 'inactive', 'no_purchases')))
         or (o = 'in' and (jsonb_typeof(v) <> 'array' or exists (select 1 from jsonb_array_elements_text(v) e where e not in ('active', 'at_risk', 'inactive', 'no_purchases')))) then errs := errs || to_jsonb(format('Condição %s: estado inválido.', n)); end if;
    elsif f = 'category' then
      if o not in ('has', 'not_has') or jsonb_typeof(v) <> 'string' or char_length(v #>> '{}') not between 1 and 80 then errs := errs || to_jsonb(format('Condição %s: informe a categoria.', n)); end if;
    elsif f = 'assigned_to' then
      if o not in ('eq', 'is_null', 'not_null') or (o = 'eq' and (jsonb_typeof(v) <> 'string' or (v #>> '{}') !~ '^[0-9a-f-]{36}$')) then errs := errs || to_jsonb(format('Condição %s: responsável inválido.', n)); end if;
    elsif f = 'campaign_history' then
      if o not in ('any', 'none') then errs := errs || to_jsonb(format('Condição %s: use «já participou» ou «nunca participou».', n)); end if;
    elsif f = 'permission' then
      if o not in ('allowed', 'not_allowed') or jsonb_typeof(v) <> 'string' or (v #>> '{}') not in ('phone', 'whatsapp', 'email') then errs := errs || to_jsonb(format('Condição %s: informe o canal.', n)); end if;
    else errs := errs || to_jsonb(format('Condição %s: campo desconhecido.', n)); end if;
  end loop;
  return errs;
end $$;

create function private.pv_cond_sql(c jsonb) returns text
language plpgsql immutable set search_path = '' as $$
declare f text := c ->> 'field'; o text := c ->> 'op'; v jsonb := c -> 'value';
  col text; opsql text;
begin
  opsql := case o when 'gt' then '>' when 'gte' then '>=' when 'lt' then '<' when 'lte' then '<=' when 'eq' then '=' end;
  if f in ('days_since_last', 'total_spent_cents', 'purchases_count') then
    col := case f when 'days_since_last' then 'b.days_since' when 'total_spent_cents' then 'b.net_total_cents' else 'b.n_valid' end;
    return format('(%s %s %s)', col, opsql, ((v #>> '{}')::numeric)::text);
  elsif f = 'last_purchase_date' then return format('(b.last_at %s %L::date)', opsql, v #>> '{}');
  elsif f = 'rfm_segment' then return format('(%s coalesce(b.seg, ''sem_compras'') = any (%L::text[]))', case when o = 'not_in' then 'not' else '' end, (select array_agg(e) from jsonb_array_elements_text(v) e));
  elsif f = 'state' then return format('(b.state = any (%L::text[]))', case when o = 'eq' then array[v #>> '{}'] else (select array_agg(e) from jsonb_array_elements_text(v) e) end);
  elsif f = 'category' then return format('(%s exists (select 1 from public.purchase_items i join public.purchases pu on pu.id = i.purchase_id where pu.customer_id = b.customer_id and pu.is_valid and lower(i.category) = lower(%L)))', case when o = 'not_has' then 'not' else '' end, v #>> '{}');
  elsif f = 'assigned_to' then return case o when 'is_null' then '(b.assigned_to is null)' when 'not_null' then '(b.assigned_to is not null)' else format('(b.assigned_to = %L::uuid)', v #>> '{}') end;
  elsif f = 'campaign_history' then return format('(%s exists (select 1 from public.campaign_memberships m where m.customer_id = b.customer_id and m.status <> ''excluded''))', case when o = 'none' then 'not' else '' end);
  elsif f = 'permission' then return format('(%s (exists (select 1 from public.communication_preferences cp where cp.customer_id = b.customer_id and cp.channel = %L::public.pv_channel and cp.permission_status in (''granted'', ''legitimate_interest''))
      and not exists (select 1 from public.suppression_entries se where se.customer_id = b.customer_id and se.lifted_at is null and (se.channel is null or se.channel = %L::public.pv_channel))))', case when o = 'not_allowed' then 'not' else '' end, v #>> '{}', v #>> '{}');
  end if;
  raise exception 'condição inválida' using errcode = '22023';
end $$;

-- Integrantes do segmento (security INVOKER: o vendedor só alcança seus clientes).
create function public.pv_segment_members(p_org uuid, p_criteria jsonb) returns table (customer_id uuid)
language plpgsql stable security invoker set search_path = '' as $$
declare errs jsonb; conds text[]; sql text; run uuid; joiner text;
begin
  errs := public.pv_validate_criteria(p_criteria);
  if jsonb_array_length(errs) > 0 then raise exception 'critérios inválidos: %', errs ->> 0 using errcode = '22023'; end if;
  conds := array(select private.pv_cond_sql(c) from jsonb_array_elements(p_criteria -> 'conditions') c);
  joiner := case coalesce(p_criteria ->> 'match', 'all') when 'any' then ' or ' else ' and ' end;
  select id into run from public.rfm_runs where organization_id = p_org order by model_version desc limit 1;
  sql := format($q$
    select b.customer_id from (
      select g.*, cu.assigned_to, sc.segment_key as seg from public.pv_customer_signals(%L::uuid, private.pv_today(%L::uuid)) g
      join public.customers cu on cu.id = g.customer_id
      left join public.customer_rfm_scores sc on sc.customer_id = g.customer_id and sc.run_id = %L::uuid
    ) b where %s$q$, p_org, p_org, run, array_to_string(conds, joiner));
  return query execute sql;
end $$;

create function public.pv_segment_refresh(p_segment uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare sd public.segment_definitions%rowtype; n int;
begin
  select * into sd from public.segment_definitions where id = p_segment;
  if not found then raise exception 'segmento não encontrado' using errcode = 'P0002'; end if;
  perform private.pv_assert_manager(sd.organization_id);
  delete from public.segment_memberships where segment_id = p_segment;
  insert into public.segment_memberships (organization_id, segment_id, customer_id) select sd.organization_id, p_segment, m.customer_id from public.pv_segment_members(sd.organization_id, sd.criteria_json) m;
  get diagnostics n = row_count;
  return n;
end $$;

-- Critérios inválidos nunca são gravados.
create function private.pv_segment_check() returns trigger language plpgsql set search_path = '' as $$
declare e jsonb;
begin
  e := public.pv_validate_criteria(new.criteria_json);
  if jsonb_array_length(e) > 0 then raise exception 'critérios inválidos: %', e ->> 0 using errcode = '23514'; end if;
  return new;
end $$;
create trigger segments_validate before insert or update of criteria_json on public.segment_definitions for each row execute function private.pv_segment_check();

do $$
declare f text;
begin
  foreach f in array array['public.pv_score_fixed(numeric, jsonb, boolean)', 'public.pv_rfm_scores(jsonb, text, jsonb)', 'public.pv_rfm_classify(integer, integer, integer, integer, integer, integer)',
    'public.pv_customer_signals(uuid, date)', 'public.pv_rfm_run(uuid, date, integer)', 'public.pv_refresh(uuid)', 'public.pv_opp_action(uuid, text, text)',
    'public.pv_validate_criteria(jsonb)', 'public.pv_segment_members(uuid, jsonb)', 'public.pv_segment_refresh(uuid)', 'private.pv_cond_sql(jsonb)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

commit;
