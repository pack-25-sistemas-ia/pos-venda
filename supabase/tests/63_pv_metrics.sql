-- Indicadores: KPIs, séries, distribuições, coortes, campanhas, alertas, filtros e isolamento. Números esperados calculados à mão.
-- Org A: A (owner), S1 (vendedor, dono de X1), V (leitor). Org B: B (coortes).

\set as_a 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-00000000000a","aal":"aal2"}'', true); set local role authenticated;'
\set as_s1 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-000000000001","aal":"aal1"}'', true); set local role authenticated;'
\set as_v 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-00000000000e","aal":"aal1"}'', true); set local role authenticated;'
\set as_b 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-00000000000b","aal":"aal2"}'', true); set local role authenticated;'
\set as_anon 'select set_config(''request.jwt.claims'', ''{}'', true); set local role anon;'

begin;

insert into auth.users (id, email) values
  ('ffffffff-0000-4000-8000-00000000000a', 'a@mt.invalid'), ('ffffffff-0000-4000-8000-000000000001', 's1@mt.invalid'),
  ('ffffffff-0000-4000-8000-00000000000e', 'v@mt.invalid'), ('ffffffff-0000-4000-8000-00000000000b', 'b@mt.invalid');

:as_a
do $$
declare a uuid;
begin
  a := public.create_organization('MT A', 'mt-a');
  insert into public.organization_members (organization_id, user_id, role) values
    (a, 'ffffffff-0000-4000-8000-000000000001', 'member'), (a, 'ffffffff-0000-4000-8000-00000000000e', 'viewer');
  perform set_config('t.org', a::text, true);
end $$;
reset role;
:as_b
do $$ begin perform set_config('t.orgb', public.create_organization('MT B', 'mt-b')::text, true); end $$;
reset role;

create function pg_temp.d(n int) returns timestamptz language sql stable as $$
  select (((now() at time zone 'America/Sao_Paulo')::date - n)::timestamp + time '12:00') at time zone 'America/Sao_Paulo' $$;
create function pg_temp.dd(n int) returns date language sql stable as $$ select (now() at time zone 'America/Sao_Paulo')::date - n $$;

-- ================= base =================
-- X1 (vendedor S1): d(40)=10000 e d(3)=10000 [item Bebidas]. X2: d(20)=30000 e d(10)=20000. X3: d(5)=8000.
-- X4: cancelada d(8). X5: estorno total d(6). X6: d(100)=5000 (fora do período de 30 dias).
do $$
declare org uuid := current_setting('t.org')::uuid; s1 uuid := 'ffffffff-0000-4000-8000-000000000001';
begin
  insert into public.customers (id, organization_id, name, email, assigned_to) values
    ('00000000-0000-4000-8000-0000000000a1', org, 'X1', 'x1@x.com', s1), ('00000000-0000-4000-8000-0000000000a2', org, 'X2', 'x2@x.com', null),
    ('00000000-0000-4000-8000-0000000000a3', org, 'X3', 'x3@x.com', null), ('00000000-0000-4000-8000-0000000000a4', org, 'X4', 'x4@x.com', null),
    ('00000000-0000-4000-8000-0000000000a5', org, 'X5', 'x5@x.com', null), ('00000000-0000-4000-8000-0000000000a6', org, 'X6', 'x6@x.com', null),
    ('00000000-0000-4000-8000-0000000000a7', org, 'X7', 'x7@x.com', null);
  insert into public.purchases (organization_id, customer_id, purchased_at, total_cents, refunded_cents, status, external_order_id) values
    (org, '00000000-0000-4000-8000-0000000000a1', pg_temp.d(40), 10000, 0, 'completed', 'x1-1'), (org, '00000000-0000-4000-8000-0000000000a1', pg_temp.d(3), 10000, 0, 'completed', 'x1-2'),
    (org, '00000000-0000-4000-8000-0000000000a2', pg_temp.d(20), 30000, 0, 'completed', 'x2-1'), (org, '00000000-0000-4000-8000-0000000000a2', pg_temp.d(10), 20000, 0, 'completed', 'x2-2'),
    (org, '00000000-0000-4000-8000-0000000000a3', pg_temp.d(5), 8000, 0, 'completed', 'x3-1'),
    (org, '00000000-0000-4000-8000-0000000000a4', pg_temp.d(8), 9000, 0, 'cancelled', 'x4-1'),
    (org, '00000000-0000-4000-8000-0000000000a5', pg_temp.d(6), 7000, 7000, 'completed', 'x5-1'),
    (org, '00000000-0000-4000-8000-0000000000a6', pg_temp.d(100), 5000, 0, 'completed', 'x6-1'),
    (org, '00000000-0000-4000-8000-0000000000a7', pg_temp.d(40), 6000, 0, 'completed', 'x7-1');
  insert into public.purchase_items (organization_id, purchase_id, product_name, category, quantity, unit_price_cents, total_cents)
    select org, id, 'Café', 'Bebidas', 1, 10000, 10000 from public.purchases where external_order_id = 'x1-2';
  -- reativação observada: X2 comprou em d(10), 25 dias após a oportunidade identificada em d(35) (dentro da janela de 30)
  insert into public.reactivation_opportunities (id, organization_id, customer_id, reason, priority, status, identified_at, resolved_at, reactivated_purchase_id)
    select '00000000-0000-4000-8000-0000000000e1', org, '00000000-0000-4000-8000-0000000000a2', 'inactivity', 80, 'reactivated', pg_temp.d(35), pg_temp.d(10), id from public.purchases where external_order_id = 'x2-2';
  insert into public.reactivation_opportunities (id, organization_id, customer_id, reason, priority, status, identified_at) values
    ('00000000-0000-4000-8000-0000000000e2', org, '00000000-0000-4000-8000-0000000000a6', 'inactivity', 75, 'open', pg_temp.d(60)),
    ('00000000-0000-4000-8000-0000000000e3', org, '00000000-0000-4000-8000-0000000000a3', 'cycle', 50, 'open', pg_temp.d(5));
  -- X7 recomprou 60 dias depois de identificada: fora da janela de 30 dias, NÃO conta como reativação observada
  insert into public.reactivation_opportunities (id, organization_id, customer_id, reason, priority, status, identified_at, resolved_at, reactivated_purchase_id)
    select '00000000-0000-4000-8000-0000000000e4', org, '00000000-0000-4000-8000-0000000000a7', 'inactivity', 60, 'reactivated', pg_temp.d(100), pg_temp.d(40), id from public.purchases where external_order_id = 'x7-1';
  insert into public.customer_lifecycle_events (organization_id, customer_id, event_type, event_key, metadata, occurred_at)
    select org, '00000000-0000-4000-8000-0000000000a2', 'reactivated', 'react:x2', jsonb_build_object('purchase_id', id), pg_temp.d(10) from public.purchases where external_order_id = 'x2-2';
  -- tarefa vencida (cliente X1) e tarefa em dia
  insert into public.customer_activities (organization_id, customer_id, type, title, due_at) values
    (org, '00000000-0000-4000-8000-0000000000a1', 'call', 'vencida', now() - interval '2 days'), (org, '00000000-0000-4000-8000-0000000000a3', 'call', 'em dia', now() + interval '2 days');
  -- campanha: 3 elegíveis + 1 excluído; 2 contatados (1 respondeu); 1 recompra de 20000
  insert into public.campaigns (id, organization_id, name, channel, status) values ('00000000-0000-4000-8000-0000000000c0', org, 'Camp teste', 'phone', 'running');
  insert into public.campaign_memberships (organization_id, campaign_id, customer_id, status) values
    (org, '00000000-0000-4000-8000-0000000000c0', '00000000-0000-4000-8000-0000000000a1', 'contacted'),
    (org, '00000000-0000-4000-8000-0000000000c0', '00000000-0000-4000-8000-0000000000a2', 'rebought'),
    (org, '00000000-0000-4000-8000-0000000000c0', '00000000-0000-4000-8000-0000000000a3', 'eligible'),
    (org, '00000000-0000-4000-8000-0000000000c0', '00000000-0000-4000-8000-0000000000a4', 'excluded');
  insert into public.campaign_contacts (organization_id, campaign_id, customer_id, contact_method, contact_status, contacted_at) values
    (org, '00000000-0000-4000-8000-0000000000c0', '00000000-0000-4000-8000-0000000000a1', 'phone', 'contacted', pg_temp.d(15)),
    (org, '00000000-0000-4000-8000-0000000000c0', '00000000-0000-4000-8000-0000000000a2', 'phone', 'responded', pg_temp.d(15)),
    (org, '00000000-0000-4000-8000-0000000000c0', '00000000-0000-4000-8000-0000000000a3', 'phone', 'planned', null);
  -- campanhas criadas ANTES do período: a em andamento continua aparecendo; a concluída antes do período, não; o rascunho antigo, não
  insert into public.campaigns (id, organization_id, name, channel, status, created_at, completed_at) values
    ('00000000-0000-4000-8000-0000000000c1', org, 'Camp antiga em andamento', 'phone', 'running', pg_temp.d(100), null),
    ('00000000-0000-4000-8000-0000000000c2', org, 'Camp antiga concluída', 'phone', 'completed', pg_temp.d(100), pg_temp.d(60)),
    ('00000000-0000-4000-8000-0000000000c3', org, 'Camp rascunho antigo', 'phone', 'draft', pg_temp.d(100), null);
  insert into public.campaign_outcomes (organization_id, campaign_id, customer_id, outcome_type, related_purchase_id, outcome_at)
    select org, '00000000-0000-4000-8000-0000000000c0', '00000000-0000-4000-8000-0000000000a2', 'rebought', id, purchased_at from public.purchases where external_order_id = 'x2-2';
end $$;

-- ================= KPIs (últimos 30 dias) =================
-- período: X1 d3 (10000, recompra), X2 d20 (30000), X2 d10 (20000, recompra), X3 d5 (8000) → 4 pedidos, R$ 680,00, ticket 17000
-- compradores 3, recompradores 1 (X2) → 33,33 %; reativados 1 (X2), receita 20000; tarefas vencidas 1
:as_a
do $$
declare org uuid := current_setting('t.org')::uuid; k record;
begin
  select * into k from public.pv_kpis(org, pg_temp.dd(29), pg_temp.dd(0));
  assert k.orders = 4, format('pedidos %s', k.orders);
  assert k.revenue_cents = 68000, format('receita %s', k.revenue_cents);
  assert k.avg_ticket_cents = 17000, 'ticket médio';
  assert k.recent_customers = 3, 'clientes que compraram no período';
  assert k.repurchase_buyers = 3 and k.repurchase_repeat = 1 and k.repurchase_rate = 33.33, format('recompra %s', k.repurchase_rate);
  assert k.reactivated = 1 and k.reactivation_revenue_cents = 20000, 'reativação observada';
  assert k.overdue_tasks = 1, 'tarefas vencidas';
  assert k.at_risk + k.inactive >= 0, 'estados presentes';
  -- coorte da taxa de reativação: período amplo (120 dias): e1 (reativou em 25 dias), e2 (não reativou) e e4 (reativou só após 60 dias) com janela de 30 dias encerrada; e3 (identificada há 5 dias) fica fora
  select * into k from public.pv_kpis(org, pg_temp.dd(120), pg_temp.dd(0));
  assert k.reactivation_cohort = 3 and k.reactivation_cohort_done = 1 and k.reactivation_rate = 33.33, format('taxa de reativação observada %s/%s', k.reactivation_cohort_done, k.reactivation_cohort);
  -- filtro de vendedor: só X1
  select * into k from public.pv_kpis(org, pg_temp.dd(29), pg_temp.dd(0), 'ffffffff-0000-4000-8000-000000000001');
  assert k.orders = 1 and k.revenue_cents = 10000, 'filtro por responsável';
  -- filtro de categoria: só a compra com item Bebidas
  select * into k from public.pv_kpis(org, pg_temp.dd(29), pg_temp.dd(0), null, null, 'bebidas');
  assert k.orders = 1 and k.revenue_cents = 10000, 'filtro por categoria (sem diferenciar maiúsculas)';
  -- sem compras no período: ticket nulo, nunca divisão por zero
  select * into k from public.pv_kpis(org, pg_temp.dd(200), pg_temp.dd(150));
  assert k.orders = 0 and k.avg_ticket_cents is null and k.repurchase_rate is null, 'período vazio';
  assert test.throws(format($q$select * from public.pv_kpis(%L, current_date, current_date - 1)$q$, org)), 'período invertido recusado';
  assert test.throws(format($q$select * from public.pv_kpis(%L, current_date - 2000, current_date)$q$, org)), 'período longo demais recusado';
end $$;

-- ================= série =================
do $$
declare org uuid := current_setting('t.org')::uuid;
begin
  assert test.count(format('select 1 from public.pv_series(%L, current_date - 29, current_date)', org)) = 30, '30 dias = 30 pontos (dias sem venda aparecem zerados)';
  assert (select granularity from public.pv_series(org, pg_temp.dd(29), pg_temp.dd(0)) limit 1) = 'day', 'granularidade diária';
  assert (select orders from public.pv_series(org, pg_temp.dd(29), pg_temp.dd(0)) where bucket = pg_temp.dd(3)) = 1, 'pedido do dia certo';
  assert (select sum(orders) from public.pv_series(org, pg_temp.dd(29), pg_temp.dd(0))) = 4, 'soma da série = pedidos';
  assert (select sum(repeat_revenue_cents) from public.pv_series(org, pg_temp.dd(29), pg_temp.dd(0))) = 30000, 'receita de recompra = d3 (10000) + d10 (20000)';
  assert (select sum(reactivated) from public.pv_series(org, pg_temp.dd(29), pg_temp.dd(0))) = 1, 'reativações na série';
  assert (select granularity from public.pv_series(org, pg_temp.dd(150), pg_temp.dd(0)) limit 1) = 'week', 'granularidade semanal';
  assert (select granularity from public.pv_series(org, pg_temp.dd(400), pg_temp.dd(0)) limit 1) = 'month', 'granularidade mensal';
end $$;

-- ================= distribuições =================
do $$
declare org uuid := current_setting('t.org')::uuid;
begin
  assert (select sum(customers) from public.pv_state_distribution(org, pg_temp.dd(0))) = 7, 'todos os clientes em algum estado';
  assert (select customers from public.pv_state_distribution(org, pg_temp.dd(0)) where state = 'no_purchases') = 2, 'X4 (cancelada) e X5 (estorno total) não contam como compradores';
  assert (select customers from public.pv_frequency_bands(org, pg_temp.dd(29), pg_temp.dd(0)) where ord = 1) = 2, 'faixa 1 pedido (X1, X3)';
  assert (select customers from public.pv_frequency_bands(org, pg_temp.dd(29), pg_temp.dd(0)) where ord = 2) = 1, 'faixa 2 pedidos (X2)';
  assert (select customers from public.pv_frequency_bands(org, pg_temp.dd(29), pg_temp.dd(0)) where ord = 4) = 0, 'faixa 5+ vazia';
  perform public.pv_rfm_run(org);
  assert (select sum(customers) from public.pv_rfm_distribution(org)) = 7, 'distribuição RFM cobre todos os clientes';
  assert (select count(*) from public.pv_rfm_distribution(org) where segment_key = 'sem_compras') = 1, 'sem compras agrupado';
  assert (select customers from public.pv_rfm_distribution(org) where segment_key = 'sem_compras') = 2, 'dois sem compras';
end $$;

-- ================= campanhas =================
do $$
declare org uuid := current_setting('t.org')::uuid; c record;
begin
  select * into c from public.pv_campaign_stats(org, pg_temp.dd(29), pg_temp.dd(0)) where name = 'Camp teste';
  assert c.eligible = 3 and c.excluded = 1, format('elegíveis/excluídos %s/%s', c.eligible, c.excluded);
  assert c.contacted = 2 and c.responded = 1 and c.response_rate = 50.00, 'contatados e respostas (planejado não conta)';
  assert c.rebought = 1 and c.rebought_value_cents = 20000, 'recompra observada';
  assert (select sum(contacts) from public.pv_campaign_series(org, pg_temp.dd(29), pg_temp.dd(0))) = 2, 'série de contatos';
  assert (select sum(rebuys) from public.pv_campaign_series(org, pg_temp.dd(29), pg_temp.dd(0))) = 1, 'série de recompras';
  assert test.count(format('select 1 from public.pv_campaign_stats(%L, current_date - 400, current_date - 300)', org)) = 0, 'campanha fora do período não aparece';
  assert exists (select 1 from public.pv_campaign_stats(org, pg_temp.dd(29), pg_temp.dd(0)) where name = 'Camp antiga em andamento'), 'campanha em andamento criada antes do período continua aparecendo';
  assert not exists (select 1 from public.pv_campaign_stats(org, pg_temp.dd(29), pg_temp.dd(0)) where name in ('Camp antiga concluída', 'Camp rascunho antigo')), 'concluída antes do período e rascunho antigo não aparecem';
  assert exists (select 1 from public.pv_campaign_stats(org, pg_temp.dd(89), pg_temp.dd(50)) where name = 'Camp antiga concluída'), 'concluída dentro do período aparece';
end $$;

-- ================= alertas =================
do $$
declare org uuid := current_setting('t.org')::uuid;
begin
  assert (select customers from public.pv_alerts(org) where key = 'overdue_tasks') = 1, 'alerta de tarefas vencidas';
  assert (select customers from public.pv_alerts(org) where key = 'high_priority_open') = 1, 'oportunidade aberta de prioridade alta (e2, 75 ≥ 70)';
  assert (select customers from public.pv_alerts(org) where key = 'no_contact_open') = 1, 'aberta há mais de 7 dias sem contato (e2; e3 é recente)';
end $$;
reset role;

-- ================= papéis: o RLS limita o que cada um enxerga =================
:as_s1
do $$
declare org uuid := current_setting('t.org')::uuid;
begin
  assert (select orders from public.pv_kpis(org, pg_temp.dd(29), pg_temp.dd(0))) = 1, 'vendedor enxerga só os pedidos dos clientes dele (X1)';
  assert (select sum(customers) from public.pv_state_distribution(org, pg_temp.dd(0))) = 1, 'vendedor: estados só da carteira dele';
end $$;
reset role;
:as_v
do $$
declare org uuid := current_setting('t.org')::uuid;
begin
  assert (select orders from public.pv_kpis(org, pg_temp.dd(29), pg_temp.dd(0))) = 4, 'leitor enxerga os números da organização';
  assert test.count(format('select 1 from public.pv_user_labels(%L)', org)) = 3, 'rótulos dos membros (dono, vendedor, leitor)';
end $$;
reset role;
:as_b
do $$
declare org uuid := current_setting('t.org')::uuid;
begin
  assert test.throws(format($q$select * from public.pv_kpis(%L, current_date - 29, current_date)$q$, org)), 'outra organização: indicadores recusados (sem configuração visível)';
  assert test.throws(format($q$select * from public.pv_state_distribution(%L, current_date)$q$, org)), 'outra organização: distribuição recusada';
  assert test.count(format('select 1 from public.pv_user_labels(%L)', org)) = 0, 'não-membro não lista usuários';
  assert test.count(format('select 1 from public.pv_campaign_stats(%L, current_date - 29, current_date)', org)) = 0, 'não-membro não vê campanhas';
end $$;
reset role;
:as_anon
do $$
begin
  assert test.throws(format($q$select * from public.pv_kpis(%L, current_date - 29, current_date)$q$, current_setting('t.org'))), 'anônimo não executa indicadores';
  assert test.throws(format($q$select * from public.pv_alerts(%L)$q$, current_setting('t.org'))), 'anônimo não lê alertas';
end $$;
reset role;

-- ================= coortes (org B, isoladas dos dados acima) =================
-- Y1: 1ª compra há 2 meses (dia 5), recompra no mês seguinte (dia 5). Y2: 1ª há 2 meses (dia 10). Y3: 1ª no mês passado (dia 3), recompra no mesmo mês (dia 20).
-- esperado: coorte M-2 (tamanho 2): mês 0 = 2, mês 1 = 1. Coorte M-1 (tamanho 1): mês 0 = 1.
do $$
declare org uuid := current_setting('t.orgb')::uuid; cur date := date_trunc('month', now() at time zone 'America/Sao_Paulo')::date;
begin
  insert into public.customers (id, organization_id, name, email) values
    ('00000000-0000-4000-8000-0000000000b1', org, 'Y1', 'y1@x.com'), ('00000000-0000-4000-8000-0000000000b2', org, 'Y2', 'y2@x.com'), ('00000000-0000-4000-8000-0000000000b3', org, 'Y3', 'y3@x.com');
  insert into public.purchases (organization_id, customer_id, purchased_at, total_cents, status, external_order_id)
  select org, c, ((cur + off)::timestamp + time '12:00') at time zone 'America/Sao_Paulo', 1000, 'completed', o
  from (values
    ('00000000-0000-4000-8000-0000000000b1'::uuid, (interval '-2 months' + interval '4 days'), 'y1-1'),
    ('00000000-0000-4000-8000-0000000000b1'::uuid, (interval '-1 month' + interval '4 days'), 'y1-2'),
    ('00000000-0000-4000-8000-0000000000b2'::uuid, (interval '-2 months' + interval '9 days'), 'y2-1'),
    ('00000000-0000-4000-8000-0000000000b3'::uuid, (interval '-1 month' + interval '2 days'), 'y3-1'),
    ('00000000-0000-4000-8000-0000000000b3'::uuid, (interval '-1 month' + interval '19 days'), 'y3-2')) v(c, off, o);
end $$;
:as_b
do $$
declare org uuid := current_setting('t.orgb')::uuid; cur date := date_trunc('month', now() at time zone 'America/Sao_Paulo')::date;
begin
  assert (select cohort_size from public.pv_cohorts(org, 6) where cohort_month = (cur - interval '2 months')::date and month_offset = 0) = 2, 'tamanho da coorte M-2';
  assert (select customers from public.pv_cohorts(org, 6) where cohort_month = (cur - interval '2 months')::date and month_offset = 0) = 2, 'coorte M-2, mês 0';
  assert (select customers from public.pv_cohorts(org, 6) where cohort_month = (cur - interval '2 months')::date and month_offset = 1) = 1, 'coorte M-2, mês 1 (só Y1 voltou)';
  assert (select count(*) from public.pv_cohorts(org, 6) where cohort_month = (cur - interval '2 months')::date and month_offset = 2) = 0, 'mês 2 sem retorno não vira linha';
  assert (select customers from public.pv_cohorts(org, 6) where cohort_month = (cur - interval '1 month')::date and month_offset = 0) = 1, 'coorte M-1, mês 0 (a segunda compra do mesmo mês não duplica)';
  assert test.throws(format($q$select * from public.pv_cohorts(%L, 1)$q$, org)), 'janela de coorte inválida recusada';
end $$;
reset role;

-- sem coortes suficientes (filtro de responsável sem clientes): nada a mostrar
:as_a
do $$
begin
  assert test.count(format('select 1 from public.pv_cohorts(%L, 6, ''ffffffff-0000-4000-8000-00000000000e'')', current_setting('t.org'))) = 0, 'menos de 2 coortes: vazio';
end $$;
reset role;

rollback;
select 'PASS 63_pv_metrics' as result;
