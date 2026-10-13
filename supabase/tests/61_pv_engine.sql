-- Motor: sinais por cliente, rodada RFM (histórico imutável), oportunidades (prioridade, explicação, idempotência), reativação, segmentos dinâmicos.
-- Todos os números esperados foram calculados à mão (ver comentários). Datas relativas a hoje, ao meio-dia no fuso da organização.
-- Org A: A (owner), M (gestor), S1 (vendedor, cliente C1), V (leitor). Org B: B.

\set as_a 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-00000000000a","aal":"aal2"}'', true); set local role authenticated;'
\set as_m 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-00000000000c","aal":"aal1"}'', true); set local role authenticated;'
\set as_s1 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-000000000001","aal":"aal1"}'', true); set local role authenticated;'
\set as_v 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-00000000000e","aal":"aal1"}'', true); set local role authenticated;'
\set as_b 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-00000000000b","aal":"aal2"}'', true); set local role authenticated;'
\set as_anon 'select set_config(''request.jwt.claims'', ''{}'', true); set local role anon;'

begin;

insert into auth.users (id, email) values
  ('ffffffff-0000-4000-8000-00000000000a', 'a@pv.invalid'), ('ffffffff-0000-4000-8000-00000000000c', 'm@pv.invalid'), ('ffffffff-0000-4000-8000-000000000001', 's1@pv.invalid'),
  ('ffffffff-0000-4000-8000-00000000000e', 'v@pv.invalid'), ('ffffffff-0000-4000-8000-00000000000b', 'b@pv.invalid');

:as_a
do $$
declare a uuid;
begin
  a := public.create_organization('PV A', 'pv-a');
  insert into public.organization_members (organization_id, user_id, role) values
    (a, 'ffffffff-0000-4000-8000-00000000000c', 'manager'), (a, 'ffffffff-0000-4000-8000-000000000001', 'member'), (a, 'ffffffff-0000-4000-8000-00000000000e', 'viewer');
  perform set_config('t.org', a::text, true);
end $$;
reset role;
:as_b
do $$ begin perform set_config('t.orgb', public.create_organization('PV B', 'pv-b')::text, true); end $$;
reset role;

create function pg_temp.d(n int) returns timestamptz language sql stable as $$
  select (((now() at time zone 'America/Sao_Paulo')::date - n)::timestamp + time '12:00') at time zone 'America/Sao_Paulo' $$;

-- ================= base de dados (inserção direta como dono: datas passadas) =================
do $$
declare org uuid := current_setting('t.org')::uuid; cid uuid; k int;
  s1 uuid := 'ffffffff-0000-4000-8000-000000000001';
begin
  -- nome, dias atrás de cada compra e valor líquido por compra
  perform set_config('t.dummy', '1', true);
  insert into public.customers (id, organization_id, name, email, assigned_to) values
    ('00000000-0000-4000-8000-0000000000c1', org, 'C1 Fiel', 'c1@x.com', s1), ('00000000-0000-4000-8000-0000000000c2', org, 'C2 Ciclo', 'c2@x.com', null),
    ('00000000-0000-4000-8000-0000000000c3', org, 'C3 Inativo', 'c3@x.com', null), ('00000000-0000-4000-8000-0000000000c4', org, 'C4 Risco', 'c4@x.com', null),
    ('00000000-0000-4000-8000-0000000000c5', org, 'C5 Novo', 'c5@x.com', null), ('00000000-0000-4000-8000-0000000000c6', org, 'C6 Sem compras', 'c6@x.com', null),
    ('00000000-0000-4000-8000-0000000000c7', org, 'C7 Cancelada', 'c7@x.com', null), ('00000000-0000-4000-8000-0000000000c8', org, 'C8 Estorno total', 'c8@x.com', null),
    ('00000000-0000-4000-8000-0000000000c9', org, 'C9 Estorno parcial', 'c9@x.com', null), ('00000000-0000-4000-8000-0000000000ca', org, 'C10 Arquivado', 'ca@x.com', null),
    ('00000000-0000-4000-8000-0000000000cb', org, 'C11 Fiel 2', 'cb@x.com', null), ('00000000-0000-4000-8000-0000000000cc', org, 'C12 Antes da janela', 'cc@x.com', null);
  update public.customers set archived_at = now() where id = '00000000-0000-4000-8000-0000000000ca';
  insert into public.purchases (organization_id, customer_id, purchased_at, total_cents, refunded_cents, status, external_order_id) values
    (org, '00000000-0000-4000-8000-0000000000c1', pg_temp.d(10), 10000, 0, 'completed', 'c1-1'), (org, '00000000-0000-4000-8000-0000000000c1', pg_temp.d(40), 10000, 0, 'completed', 'c1-2'),
    (org, '00000000-0000-4000-8000-0000000000c1', pg_temp.d(70), 10000, 0, 'completed', 'c1-3'), (org, '00000000-0000-4000-8000-0000000000c1', pg_temp.d(100), 10000, 0, 'completed', 'c1-4'),
    (org, '00000000-0000-4000-8000-0000000000c1', pg_temp.d(130), 10000, 0, 'completed', 'c1-5'),
    (org, '00000000-0000-4000-8000-0000000000c2', pg_temp.d(75), 20000, 0, 'completed', 'c2-1'), (org, '00000000-0000-4000-8000-0000000000c2', pg_temp.d(105), 20000, 0, 'completed', 'c2-2'),
    (org, '00000000-0000-4000-8000-0000000000c2', pg_temp.d(135), 20000, 0, 'completed', 'c2-3'), (org, '00000000-0000-4000-8000-0000000000c2', pg_temp.d(165), 20000, 0, 'completed', 'c2-4'),
    (org, '00000000-0000-4000-8000-0000000000c3', pg_temp.d(200), 30000, 0, 'completed', 'c3-1'),
    (org, '00000000-0000-4000-8000-0000000000c4', pg_temp.d(120), 5000, 0, 'completed', 'c4-1'), (org, '00000000-0000-4000-8000-0000000000c4', pg_temp.d(200), 5000, 0, 'completed', 'c4-2'),
    (org, '00000000-0000-4000-8000-0000000000c5', pg_temp.d(5), 8000, 0, 'completed', 'c5-1'),
    (org, '00000000-0000-4000-8000-0000000000c7', pg_temp.d(20), 9000, 0, 'cancelled', 'c7-1'),
    (org, '00000000-0000-4000-8000-0000000000c8', pg_temp.d(10), 7000, 7000, 'completed', 'c8-1'),
    (org, '00000000-0000-4000-8000-0000000000c9', pg_temp.d(15), 10000, 4000, 'completed', 'c9-1'),
    (org, '00000000-0000-4000-8000-0000000000ca', pg_temp.d(10), 5000, 0, 'completed', 'ca-1'),
    (org, '00000000-0000-4000-8000-0000000000cb', pg_temp.d(20), 4000, 0, 'completed', 'cb-1'), (org, '00000000-0000-4000-8000-0000000000cb', pg_temp.d(50), 4000, 0, 'completed', 'cb-2'),
    (org, '00000000-0000-4000-8000-0000000000cc', pg_temp.d(400), 9000, 0, 'completed', 'cc-1');
  insert into public.purchase_items (organization_id, purchase_id, product_name, category, quantity, unit_price_cents, total_cents)
    select org, id, 'Café 500g', 'Bebidas', 1, 10000, 10000 from public.purchases where external_order_id = 'c1-1';
end $$;

-- ================= sinais por cliente =================
:as_m
do $$
declare org uuid := current_setting('t.org')::uuid; r record;
begin
  select * into r from public.pv_customer_signals(org, (now() at time zone 'America/Sao_Paulo')::date) where customer_id = '00000000-0000-4000-8000-0000000000c1';
  assert r.n_valid = 5 and r.days_since = 10 and r.net_total_cents = 50000 and r.median_interval = 30 and r.median_ticket_cents = 10000 and r.orders_recent = 3 and r.orders_prev = 2 and r.state = 'active' and r.signals = '{}', 'C1: ativo, ciclo de 30 dias respeitado, sem queda';
  select * into r from public.pv_customer_signals(org, (now() at time zone 'America/Sao_Paulo')::date) where customer_id = '00000000-0000-4000-8000-0000000000c2';
  assert r.n_valid = 4 and r.days_since = 75 and r.net_total_cents = 80000 and r.median_interval = 30 and r.orders_recent = 1 and r.orders_prev = 3 and r.state = 'at_risk' and r.signals = '{cycle,frequency_drop}', 'C2: 75 dias > 1,5 × 30 (ciclo) e 1 pedido contra 3 (queda); abaixo dos 90 dias de inatividade';
  select * into r from public.pv_customer_signals(org, (now() at time zone 'America/Sao_Paulo')::date) where customer_id = '00000000-0000-4000-8000-0000000000c3';
  assert r.n_valid = 1 and r.days_since = 200 and r.state = 'inactive' and r.signals = '{inactivity}' and r.median_interval is null, 'C3: inativo (200 ≥ 180); sem ciclo (histórico insuficiente)';
  select * into r from public.pv_customer_signals(org, (now() at time zone 'America/Sao_Paulo')::date) where customer_id = '00000000-0000-4000-8000-0000000000c4';
  assert r.n_valid = 2 and r.days_since = 120 and r.state = 'at_risk' and r.signals = '{inactivity}' and r.median_interval = 80, 'C4: em risco só por inatividade; 2 compras não bastam para ciclo';
  select * into r from public.pv_customer_signals(org, (now() at time zone 'America/Sao_Paulo')::date) where customer_id = '00000000-0000-4000-8000-0000000000c5';
  assert r.n_valid = 1 and r.state = 'active' and r.signals = '{}', 'C5: novo e ativo';
  select * into r from public.pv_customer_signals(org, (now() at time zone 'America/Sao_Paulo')::date) where customer_id = '00000000-0000-4000-8000-0000000000c9';
  assert r.n_valid = 1 and r.net_total_cents = 6000, 'C9: estorno parcial reduz o líquido (10000 − 4000)';
  for r in select * from public.pv_customer_signals(org, (now() at time zone 'America/Sao_Paulo')::date) where customer_id in
      ('00000000-0000-4000-8000-0000000000c6', '00000000-0000-4000-8000-0000000000c7', '00000000-0000-4000-8000-0000000000c8') loop
    assert r.n_valid = 0 and r.state = 'no_purchases', 'sem compra válida: nunca comprou, cancelada ou estornada por inteiro';
  end loop;
  assert not exists (select 1 from public.pv_customer_signals(org, (now() at time zone 'America/Sao_Paulo')::date) where customer_id = '00000000-0000-4000-8000-0000000000ca'), 'arquivado fica de fora';
  select * into r from public.pv_customer_signals(org, (now() at time zone 'America/Sao_Paulo')::date) where customer_id = '00000000-0000-4000-8000-0000000000cc';
  assert r.state = 'inactive' and r.days_since = 400, 'C12: compra há 400 dias → inativo';
  -- data de referência no passado ignora compras posteriores (limite de data)
  select * into r from public.pv_customer_signals(org, ((now() at time zone 'America/Sao_Paulo')::date - 60)) where customer_id = '00000000-0000-4000-8000-0000000000c1';
  assert r.n_valid = 3 and r.days_since = 10 and r.last_at = ((now() at time zone 'America/Sao_Paulo')::date - 70), 'referência há 60 dias: só compras até lá';
  raise notice 'PASS: sinais por cliente (estado, ciclo, queda, estorno, cancelamento, data de referência)';
end $$;
reset role;

-- ================= rodada RFM =================
:as_s1
do $$ begin assert test.throws(format($q$select public.pv_rfm_run(%L)$q$, current_setting('t.org'))), 'vendedor não roda RFM'; end $$;
reset role;
:as_m
do $$
declare org uuid := current_setting('t.org')::uuid; rid uuid; run public.rfm_runs%rowtype;
  function_seg text;
begin
  rid := public.pv_rfm_run(org);
  perform set_config('t.run1', rid::text, true);
  select * into run from public.rfm_runs where id = rid;
  assert run.model_version = 1 and run.scored_count = 7 and not run.low_sample and run.window_days = 365 and run.mode = 'percentile', 'rodada 1: 7 clientes pontuados, janela 365';
  -- notas calculadas à mão (n = 7, aritmética inteira)
  assert (select r_score::text || f_score::text || m_score::text from public.customer_rfm_scores where run_id = rid and customer_id = '00000000-0000-4000-8000-0000000000c1') = '555', 'C1 5-5-5';
  assert (select r_score::text || f_score::text || m_score::text from public.customer_rfm_scores where run_id = rid and customer_id = '00000000-0000-4000-8000-0000000000c2') = '255', 'C2 2-5-5';
  assert (select r_score::text || f_score::text || m_score::text from public.customer_rfm_scores where run_id = rid and customer_id = '00000000-0000-4000-8000-0000000000c3') = '114', 'C3 1-1-4';
  assert (select r_score::text || f_score::text || m_score::text from public.customer_rfm_scores where run_id = rid and customer_id = '00000000-0000-4000-8000-0000000000c4') = '133', 'C4 1-3-3';
  assert (select r_score::text || f_score::text || m_score::text from public.customer_rfm_scores where run_id = rid and customer_id = '00000000-0000-4000-8000-0000000000c5') = '511', 'C5 5-1-1';
  assert (select r_score::text || f_score::text || m_score::text from public.customer_rfm_scores where run_id = rid and customer_id = '00000000-0000-4000-8000-0000000000c9') = '411', 'C9 4-1-1';
  assert (select r_score::text || f_score::text || m_score::text from public.customer_rfm_scores where run_id = rid and customer_id = '00000000-0000-4000-8000-0000000000cb') = '331', 'C11 3-3-1';
  assert (select recency_days from public.customer_rfm_scores where run_id = rid and customer_id = '00000000-0000-4000-8000-0000000000c2') = 75 and
         (select frequency from public.customer_rfm_scores where run_id = rid and customer_id = '00000000-0000-4000-8000-0000000000c2') = 4 and
         (select monetary_cents from public.customer_rfm_scores where run_id = rid and customer_id = '00000000-0000-4000-8000-0000000000c2') = 80000, 'valores R, F, M gravados';
  assert (select array_agg(c.name || ':' || s.segment_key order by c.name) from public.customer_rfm_scores s join public.customers c on c.id = s.customer_id where s.run_id = rid) =
    array['C1 Fiel:campeoes', 'C11 Fiel 2:fieis', 'C12 Antes da janela:inativos', 'C2 Ciclo:em_risco', 'C3 Inativo:em_risco', 'C4 Risco:em_risco', 'C5 Novo:novos', 'C6 Sem compras:sem_compras',
          'C7 Cancelada:sem_compras', 'C8 Estorno total:sem_compras', 'C9 Estorno parcial:novos'], 'segmentos pela regra documentada (arquivado fora; sem notas inventadas)';
  assert (select count(*) from public.customer_rfm_scores where run_id = rid and r_score is null) = 4, 'quem não comprou na janela não recebe R/F/M';
  -- determinismo: nova rodada com os mesmos dados gera as mesmas notas
  perform set_config('t.run2', public.pv_rfm_run(org)::text, true);
  assert (select count(*) from public.customer_rfm_scores a join public.customer_rfm_scores b on a.customer_id = b.customer_id and b.run_id = current_setting('t.run2')::uuid
           where a.run_id = rid and (a.r_score, a.f_score, a.m_score, a.segment_key) is distinct from (b.r_score, b.f_score, b.m_score, b.segment_key)) = 0, 'mesmos dados e parâmetros → mesmas notas';
  assert (select model_version from public.rfm_runs where id = current_setting('t.run2')::uuid) = 2, 'cada execução é uma nova versão';
  assert (select count(*) from public.customer_lifecycle_events where event_type = 'segment_changed') = 0, 'sem mudança de segmento entre rodadas idênticas';
  -- janela menor reclassifica; a rodada antiga não muda
  perform public.pv_rfm_run(org, null, 90);
  assert (select count(*) from public.customer_rfm_scores where run_id = rid) = 11 and (select scored_count from public.rfm_runs where id = rid) = 7, 'a rodada antiga permanece intacta';
  assert (select scored_count from public.rfm_runs where model_version = 3) = 5, 'janela de 90 dias: 5 clientes com compra (C1, C2, C5, C9, C11)';
  assert not (select low_sample from public.rfm_runs where model_version = 3), 'cinco clientes ainda não é amostra pequena';
  assert (select segment_key from public.customer_rfm_scores s join public.customers c on c.id = s.customer_id where s.run_id = (select id from public.rfm_runs where model_version = 3) and c.name = 'C4 Risco') = 'inativos', 'C4 não comprou nos últimos 90 dias → inativos na janela de 90';
  assert (select count(*) from public.customer_lifecycle_events where event_type = 'segment_changed') > 0, 'mudanças de segmento entre rodadas viram evento';
  raise notice 'PASS: rodada RFM — notas, valores, segmentos, determinismo, histórico e janela';
end $$;
reset role;
do $$
begin
  assert test.throws(format($q$update public.rfm_runs set window_days = 31 where id = %L$q$, current_setting('t.run1'))), 'rodada RFM é imutável';
  assert test.throws(format($q$update public.customer_rfm_scores set r_score = 5 where run_id = %L$q$, current_setting('t.run1'))), 'notas são imutáveis';
  raise notice 'PASS: histórico RFM imutável';
end $$;

-- ================= oportunidades =================
:as_m
do $$
declare org uuid := current_setting('t.org')::uuid; j jsonb; r record;
begin
  j := public.pv_refresh(org);
  assert (select count(*) from public.reactivation_opportunities where organization_id = org) = 6, 'seis oportunidades: C2 (ciclo e queda), C3, C4 e C12 (inatividade) e C11 (mudança de segmento entre as rodadas 2 e 3)';
  assert (select priority from public.reactivation_opportunities where customer_id = '00000000-0000-4000-8000-0000000000cb' and reason = 'segment_change') = 31, 'prioridade da mudança de segmento = 60 × 1/7 + 40 × 4/7 = 31';
  assert (select explanation_json ->> 'from_segment' from public.reactivation_opportunities where customer_id = '00000000-0000-4000-8000-0000000000cb' and reason = 'segment_change') = 'fieis', 'explica de qual segmento veio';
  assert (select priority from public.reactivation_opportunities where customer_id = '00000000-0000-4000-8000-0000000000c2' and reason = 'cycle') = 97, 'prioridade C2/ciclo = 97 (valor 40 + frequência 17,1 + atraso 40)';
  assert (select priority from public.reactivation_opportunities where customer_id = '00000000-0000-4000-8000-0000000000c2' and reason = 'frequency_drop') = 90, 'prioridade C2/queda = 90 (atraso 75/90)';
  assert (select priority from public.reactivation_opportunities where customer_id = '00000000-0000-4000-8000-0000000000c3') = 69, 'prioridade C3 = 69';
  assert (select priority from public.reactivation_opportunities where customer_id = '00000000-0000-4000-8000-0000000000c4') = 61, 'prioridade C4 = 61';
  assert (select priority from public.reactivation_opportunities where customer_id = '00000000-0000-4000-8000-0000000000cc') = 57, 'prioridade C12 = 57';
  assert (select estimated_value_cents from public.reactivation_opportunities where customer_id = '00000000-0000-4000-8000-0000000000c2' and reason = 'cycle') = 20000, 'valor estimado = ticket mediano (4 compras)';
  assert (select estimated_value_cents from public.reactivation_opportunities where customer_id = '00000000-0000-4000-8000-0000000000c4') is null, 'sem histórico suficiente: não inventa valor';
  select * into r from public.reactivation_opportunities where customer_id = '00000000-0000-4000-8000-0000000000c2' and reason = 'cycle';
  assert (r.explanation_json ->> 'days_since_last')::int = 75 and (r.explanation_json ->> 'median_interval_days')::numeric = 30 and (r.explanation_json ->> 'purchases')::int = 4, 'a explicação guarda os números usados';
  -- idempotência: de novo não cria nada novo
  perform public.pv_refresh(org);
  assert (select count(*) from public.reactivation_opportunities where organization_id = org) = 6, 'atualizar de novo não duplica';
  assert (select count(*) from public.customer_lifecycle_events where event_type in ('at_risk', 'inactive')) = 4, 'um evento de entrada em risco/inatividade por cliente (C2, C4, C3, C12), sem repetir';
  assert (select count(*) from public.notifications where type = 'new_opportunities') >= 1, 'gestão é avisada das novas oportunidades';
  -- parâmetro que faz a regra deixar de valer fecha as «abertas» (sem tocar nas trabalhadas)
  perform public.pv_opp_action((select id from public.reactivation_opportunities where customer_id = '00000000-0000-4000-8000-0000000000c4'), 'start');
  raise notice 'PASS: oportunidades — prioridade, explicação, valor estimado e idempotência';
end $$;
reset role;
:as_a
update public.pv_settings set rule_cycle = false where organization_id = current_setting('t.org')::uuid;
reset role;
:as_m
do $$
declare org uuid := current_setting('t.org')::uuid;
begin
  perform public.pv_refresh(org);
  assert (select status from public.reactivation_opportunities where customer_id = '00000000-0000-4000-8000-0000000000c2' and reason = 'cycle') = 'discarded', 'regra desligada: oportunidade aberta é encerrada com motivo';
  assert (select status from public.reactivation_opportunities where customer_id = '00000000-0000-4000-8000-0000000000c4') = 'in_progress', 'oportunidade em andamento não é fechada pela regra';
  assert (select state from public.pv_customer_signals(org, (now() at time zone 'America/Sao_Paulo')::date) where customer_id = '00000000-0000-4000-8000-0000000000c2') = 'at_risk', 'C2 segue em risco pela queda de frequência';
  raise notice 'PASS: regras configuráveis por organização';
end $$;
reset role;
:as_a
update public.pv_settings set rule_cycle = true where organization_id = current_setting('t.org')::uuid;
reset role;

-- ================= reativação e ações =================
:as_s1
do $$ begin
  assert test.count('select 1 from public.reactivation_opportunities') = 0, 'vendedor não vê oportunidades de clientes que não são dele';
  assert test.throws(format($q$select public.pv_refresh(%L)$q$, current_setting('t.org'))), 'vendedor não recalcula oportunidades';
end $$;
reset role;
:as_m
do $$
declare org uuid := current_setting('t.org')::uuid; o uuid; res jsonb;
begin
  o := (select id from public.reactivation_opportunities where customer_id = '00000000-0000-4000-8000-0000000000c3');
  assert test.throws(format($q$select public.pv_opp_action(%L, 'reactivated')$q$, o)), 'marcar reativada exige compra válida depois da identificação (evidência)';
  assert test.throws(format($q$select public.pv_opp_action(%L, 'discard', '  ')$q$, o)), 'descartar exige motivo';
  perform public.pv_opp_action(o, 'next_action', 'Ligar na segunda');
  assert (select next_action from public.reactivation_opportunities where id = o) = 'Ligar na segunda';
  -- nova compra do cliente inativo
  res := public.pv_purchase_create('00000000-0000-4000-8000-0000000000c3', 'c3-nova', now() + interval '1 minute', 25000, '[{"product_name":"Café","category":"Bebidas","quantity":1,"unit_price_cents":25000,"total_cents":25000}]');
  assert (res ->> 'ok')::boolean, 'compra criada';
  perform set_config('t.c3p', res ->> 'id', true);
  assert (select status from public.reactivation_opportunities where id = o) = 'reactivated' and (select reactivated_purchase_id from public.reactivation_opportunities where id = o)::text = res ->> 'id', 'recompra após a oportunidade → reativada, ligada à compra';
  assert (select count(*) from public.customer_lifecycle_events where customer_id = '00000000-0000-4000-8000-0000000000c3' and event_type = 'reactivated') = 1, 'um evento de reativação';
  perform public.pv_refresh(org);
  assert (select count(*) from public.customer_lifecycle_events where customer_id = '00000000-0000-4000-8000-0000000000c3' and event_type = 'reactivated') = 1, 'refazer não conta a reativação duas vezes';
  assert (select count(*) from public.reactivation_opportunities where customer_id = '00000000-0000-4000-8000-0000000000c3' and status in ('open', 'in_progress')) = 0, 'cliente ativo de novo: sem oportunidade aberta';
  -- cancelar a compra desfaz a reativação (integridade)
  perform public.pv_purchase_cancel((res ->> 'id')::uuid);
  assert (select status from public.reactivation_opportunities where id = o) = 'open' and (select count(*) from public.customer_lifecycle_events where customer_id = '00000000-0000-4000-8000-0000000000c3' and event_type = 'reactivated') = 0, 'compra cancelada: a oportunidade reabre e o evento sai';
  assert (select state from public.pv_customer_signals(org, (now() at time zone 'America/Sao_Paulo')::date) where customer_id = '00000000-0000-4000-8000-0000000000c3') = 'inactive', 'cliente volta a inativo';
  raise notice 'PASS: reativação detectada, sem dupla contagem, e desfeita ao cancelar a compra';
end $$;
reset role;

-- ================= segmentos dinâmicos =================
:as_m
do $$
declare org uuid := current_setting('t.org')::uuid; n int; seg uuid;
  function_ok boolean;
begin
  perform public.pv_rfm_run(org); -- rodada nova com a janela padrão (365 dias)
  create temp table pv_t_seg (k text, ids uuid[]) on commit drop;
  insert into pv_t_seg select 'risco', array_agg(customer_id order by customer_id) from public.pv_segment_members(org, '{"match":"all","conditions":[{"field":"state","op":"eq","value":"at_risk"}]}');
  assert (select ids from pv_t_seg where k = 'risco') = array['00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000c4']::uuid[], 'estado em risco = C2 e C4';
  assert (select array_agg(customer_id order by customer_id) from public.pv_segment_members(org, '{"match":"all","conditions":[{"field":"total_spent_cents","op":"gte","value":30000}]}')) =
    array['00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000c3']::uuid[], 'gasto líquido ≥ 30.000: C1, C2 e C3';
  assert (select array_agg(customer_id) from public.pv_segment_members(org, '{"match":"all","conditions":[{"field":"category","op":"has","value":"bebidas"}]}')) = array['00000000-0000-4000-8000-0000000000c1']::uuid[], 'categoria comprada (sem diferenciar maiúsculas)';
  assert (select count(*) from public.pv_segment_members(org, '{"match":"any","conditions":[{"field":"state","op":"eq","value":"inactive"},{"field":"purchases_count","op":"gte","value":5}]}')) = 3, 'qualquer uma: C3 e C12 (inativos) e C1 (5 compras)';
  assert (select array_agg(customer_id order by customer_id) from public.pv_segment_members(org, '{"match":"all","conditions":[{"field":"state","op":"in","value":["at_risk","inactive"]},{"field":"days_since_last","op":"gt","value":150}]}')) =
    array['00000000-0000-4000-8000-0000000000c3', '00000000-0000-4000-8000-0000000000cc']::uuid[], 'todas: (em risco ou inativo) e mais de 150 dias sem comprar';
  assert (select array_agg(customer_id order by customer_id) from public.pv_segment_members(org, '{"match":"all","conditions":[{"field":"rfm_segment","op":"in","value":["em_risco"]}]}')) =
    array['00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000c3', '00000000-0000-4000-8000-0000000000c4']::uuid[], 'segmento RFM da rodada mais recente';
  -- tentativa de injeção: o valor é texto escapado, não SQL
  assert (select count(*) from public.pv_segment_members(org, $c${"match":"all","conditions":[{"field":"category","op":"has","value":"x'); drop table public.customers; --"}]}$c$)) = 0, 'valor malicioso é só um texto';
  assert to_regclass('public.customers') is not null, 'nada foi executado';
  assert test.throws($q$select * from public.pv_segment_members(current_setting('t.org')::uuid, '{"match":"all","conditions":[{"field":"drop table","op":"eq","value":1}]}')$q$), 'campo fora da lista';
  assert test.throws($q$select * from public.pv_segment_members(current_setting('t.org')::uuid, '{"match":"all","conditions":[{"field":"days_since_last","op":"eq","value":"1; select 1"}]}')$q$), 'valor numérico exige número';
  assert test.throws($q$select * from public.pv_segment_members(current_setting('t.org')::uuid, '{"match":"all","conditions":[]}')$q$), 'sem condições';
  assert jsonb_array_length(public.pv_validate_criteria((select jsonb_build_object('match', 'all', 'conditions', jsonb_agg(jsonb_build_object('field', 'days_since_last', 'op', 'gt', 'value', g))) from generate_series(1, 11) g))) > 0, 'no máximo 10 condições';
  -- gravar segmento: critérios inválidos são recusados no banco
  assert test.throws(format($q$insert into public.segment_definitions (organization_id, name, criteria_json) values (%L, 'ruim', '{"match":"all","conditions":[{"field":"x","op":"y","value":1}]}')$q$, org)), 'critério inválido não é gravado';
  insert into public.segment_definitions (organization_id, name, criteria_json) values (org, 'Em risco ou inativos', '{"match":"all","conditions":[{"field":"state","op":"in","value":["at_risk","inactive"]}]}') returning id into seg;
  assert public.pv_segment_refresh(seg) = 4, 'materializa 4 integrantes (C2, C3, C4, C12)';
  assert (select count(*) from public.segment_memberships where segment_id = seg) = 4;
  raise notice 'PASS: segmentos dinâmicos (campos fechados, sem SQL livre, limites)';
end $$;
reset role;
:as_s1
do $$ begin
  assert (select count(*) from public.pv_segment_members(current_setting('t.org')::uuid, '{"match":"all","conditions":[{"field":"total_spent_cents","op":"gte","value":0}]}')) = 1, 'vendedor só alcança o próprio cliente (RLS)';
  assert test.throws(format($q$insert into public.segment_definitions (organization_id, name, criteria_json) values (%L, 'meu', '{"match":"all","conditions":[{"field":"state","op":"eq","value":"active"}]}')$q$, current_setting('t.org'))), 'vendedor não cria segmento';
end $$;
reset role;

-- ================= isolamento =================
:as_b
do $$ begin
  assert test.count('select 1 from public.customers') = 0 and test.count('select 1 from public.purchases') = 0 and test.count('select 1 from public.reactivation_opportunities') = 0 and test.count('select 1 from public.customer_rfm_scores') = 0, 'outra organização não vê nada';
  assert test.throws(format($q$select public.pv_rfm_run(%L)$q$, current_setting('t.org'))), 'nem roda RFM';
  assert test.throws(format($q$select public.pv_refresh(%L)$q$, current_setting('t.org'))), 'nem atualiza oportunidades';
  assert test.throws(format($q$select public.pv_purchase_create('00000000-0000-4000-8000-0000000000c1', null, now(), 100)$q$)), 'nem cria compra em cliente de outra empresa';
  assert test.throws(format($q$select * from public.pv_customer_signals(%L, current_date)$q$, current_setting('t.org'))), 'nem enxerga os sinais (nem a configuração)';
  raise notice 'PASS: isolamento entre organizações';
end $$;
reset role;
:as_anon
do $$ begin
  assert test.throws('select * from public.customers'), 'anon não lê clientes';
  assert test.throws(format($q$select public.pv_refresh(%L)$q$, current_setting('t.org'))), 'anon não executa';
  assert test.throws($q$select * from public.pv_customer_signals(gen_random_uuid(), current_date)$q$), 'nem os sinais';
end $$;
reset role;

rollback;
