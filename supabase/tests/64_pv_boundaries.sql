-- Limites e regras finas: cada asserção existe porque uma mutação da regra correspondente sobrevivia à suíte (scripts/mutation-check.mjs).
-- Janela e amostra do RFM, limites dos sinais de risco, regra desligada, oportunidade trabalhada, estorno, resultado de campanha, elegibilidade, fuso do período.
-- Org A: A (owner; aal2 e aal1).

\set as_a 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-00000000000a","aal":"aal2"}'', true); set local role authenticated;'
\set as_a1 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-00000000000a","aal":"aal1"}'', true); set local role authenticated;'

begin;

insert into auth.users (id, email) values ('ffffffff-0000-4000-8000-00000000000a', 'a@bd.invalid');

:as_a
do $$ begin perform set_config('t.org', public.create_organization('BD A', 'bd-a')::text, true); end $$;
reset role;

create function pg_temp.d(n int) returns timestamptz language sql stable as $$
  select (((now() at time zone 'America/Sao_Paulo')::date - n)::timestamp + time '12:00') at time zone 'America/Sao_Paulo' $$;
create function pg_temp.dd(n int) returns date language sql stable as $$ select (now() at time zone 'America/Sao_Paulo')::date - n $$;
create function pg_temp.at(n int, t time) returns timestamptz language sql stable as $$
  select (((now() at time zone 'America/Sao_Paulo')::date - n)::timestamp + t) at time zone 'America/Sao_Paulo' $$;
create function pg_temp.msg(q text) returns text language plpgsql as $$ begin execute q; return null; exception when others then return sqlerrm; end $$;
create function pg_temp.cid(n int) returns uuid language sql immutable as $$ select ('00000000-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid $$;

-- ================= base: clientes com datas de última compra nos limites =================
-- 1 W1 d30 · 2 W2 d29 · 11 B1 d90 · 12 B2 d89 · 13 B3 d180 · 14 B4 d179 · 21 C1 ciclo · 22 C2 ciclo no limite · 23 C3 duas compras · 24 C4 ciclo curto · 30 R1 d100
do $$
declare org uuid := current_setting('t.org')::uuid; i int;
begin
  for i in select unnest(array[1, 2, 11, 12, 13, 14, 21, 22, 23, 24, 30]) loop
    insert into public.customers (id, organization_id, name, email) values (pg_temp.cid(i), org, 'Cli ' || i, 'c' || i || '@x.com');
  end loop;
  insert into public.purchases (organization_id, customer_id, purchased_at, total_cents, status, external_order_id) values
    (org, pg_temp.cid(1), pg_temp.d(30), 10000, 'completed', 'w1'), (org, pg_temp.cid(2), pg_temp.d(29), 10000, 'completed', 'w2'),
    (org, pg_temp.cid(11), pg_temp.d(90), 10000, 'completed', 'b1'), (org, pg_temp.cid(12), pg_temp.d(89), 10000, 'completed', 'b2'),
    (org, pg_temp.cid(13), pg_temp.d(180), 10000, 'completed', 'b3'), (org, pg_temp.cid(14), pg_temp.d(179), 10000, 'completed', 'b4'),
    (org, pg_temp.cid(21), pg_temp.d(100), 10000, 'completed', 'c1a'), (org, pg_temp.cid(21), pg_temp.d(80), 10000, 'completed', 'c1b'), (org, pg_temp.cid(21), pg_temp.d(60), 10000, 'completed', 'c1c'),
    (org, pg_temp.cid(22), pg_temp.d(70), 10000, 'completed', 'c2a'), (org, pg_temp.cid(22), pg_temp.d(50), 10000, 'completed', 'c2b'), (org, pg_temp.cid(22), pg_temp.d(30), 10000, 'completed', 'c2c'),
    (org, pg_temp.cid(23), pg_temp.d(80), 10000, 'completed', 'c3a'), (org, pg_temp.cid(23), pg_temp.d(70), 10000, 'completed', 'c3b'),
    (org, pg_temp.cid(24), pg_temp.d(14), 10000, 'completed', 'c4a'), (org, pg_temp.cid(24), pg_temp.d(12), 10000, 'completed', 'c4b'), (org, pg_temp.cid(24), pg_temp.d(10), 10000, 'completed', 'c4c'),
    (org, pg_temp.cid(30), pg_temp.d(100), 5000, 'completed', 'r1');
end $$;

-- ================= RFM: janela, borda, amostra pequena =================
:as_a
do $$
declare org uuid := current_setting('t.org')::uuid; run uuid; i int;
begin
  assert pg_temp.msg(format('select public.pv_rfm_run(%L, null, 29)', org)) like '%janela inválida%', 'janela abaixo de 30 dias recusada';
  assert pg_temp.msg(format('select public.pv_rfm_run(%L, null, 1096)', org)) like '%janela inválida%', 'janela acima de 1095 dias recusada';
  run := public.pv_rfm_run(org, null, 30);
  -- com janela de 30 dias: d29 entra (29 < 30); d30 fica de fora (a borda não conta) e vira «inativos» por ter histórico
  assert (select segment_key from public.customer_rfm_scores where run_id = run and customer_id = pg_temp.cid(1)) = 'inativos', 'compra exatamente na borda da janela fica de fora';
  assert (select r_score from public.customer_rfm_scores where run_id = run and customer_id = pg_temp.cid(2)) is not null, 'compra a 29 dias entra na janela';
  -- pontuados: W2 (d29) e C4 (d10, d12, d14) = 2 → amostra pequena
  assert (select scored_count from public.rfm_runs where id = run) = 2, 'clientes pontuados na janela';
  assert (select low_sample from public.rfm_runs where id = run), 'menos de 5 pontuados = amostra pequena';
  -- mais três clientes recentes: 5 pontuados = amostra suficiente (o limite é «menos de 5»)
  reset role;
  for i in 41..43 loop
    insert into public.customers (id, organization_id, name, email) values (pg_temp.cid(i), org, 'Cli ' || i, 'c' || i || '@x.com');
    insert into public.purchases (organization_id, customer_id, purchased_at, total_cents, status, external_order_id) values (org, pg_temp.cid(i), pg_temp.d(1), 1000 * i, 'completed', 's' || i);
  end loop;
end $$;
:as_a
do $$
declare org uuid := current_setting('t.org')::uuid; run uuid;
begin
  run := public.pv_rfm_run(org, null, 30);
  assert (select scored_count from public.rfm_runs where id = run) = 5 and not (select low_sample from public.rfm_runs where id = run), 'cinco pontuados já não é amostra pequena';
  -- classificação direta: «novos» exige frequência 1
  assert public.pv_rfm_classify(4, 1, 1, 1, 5, 30) = 'novos', 'primeira compra recente e frequência 1 = novos';
  assert public.pv_rfm_classify(4, 1, 1, 2, 5, 30) = 'promissores', 'frequência 2 não é «novos»';
  assert public.pv_rfm_classify(3, 2, 2, 2, 5, 30) = 'atencao', 'recência média e pouca frequência = atenção';
end $$;
reset role;

-- ================= sinais de risco: limites exatos (padrões: risco 90, inativo 180, ciclo 1,5×, mínimo 3 compras, mínimo 15 dias) =================
:as_a
do $$
declare org uuid := current_setting('t.org')::uuid;
begin
  assert (select state from public.pv_customer_signals(org, pg_temp.dd(0)) where customer_id = pg_temp.cid(11)) = 'at_risk', '90 dias sem comprar = em risco (limite inclusivo)';
  assert (select signals from public.pv_customer_signals(org, pg_temp.dd(0)) where customer_id = pg_temp.cid(11)) = array['inactivity'], 'sinal de inatividade no limite';
  assert (select state from public.pv_customer_signals(org, pg_temp.dd(0)) where customer_id = pg_temp.cid(12)) = 'active', '89 dias ainda é ativo';
  assert (select state from public.pv_customer_signals(org, pg_temp.dd(0)) where customer_id = pg_temp.cid(13)) = 'inactive', '180 dias = inativo (limite inclusivo)';
  assert (select state from public.pv_customer_signals(org, pg_temp.dd(0)) where customer_id = pg_temp.cid(14)) = 'at_risk', '179 dias ainda é só risco';
  -- ciclo: intervalo mediano 20 dias, limite 1,5 × 20 = 30
  assert (select signals from public.pv_customer_signals(org, pg_temp.dd(0)) where customer_id = pg_temp.cid(21)) = array['cycle'], '60 dias > 30: ciclo vencido (sem inatividade)';
  assert (select state from public.pv_customer_signals(org, pg_temp.dd(0)) where customer_id = pg_temp.cid(22)) = 'active', 'exatamente 30 dias não passa de 1,5 × a mediana';
  assert (select state from public.pv_customer_signals(org, pg_temp.dd(0)) where customer_id = pg_temp.cid(23)) = 'active', 'ciclo exige ao menos 3 compras';
  assert (select state from public.pv_customer_signals(org, pg_temp.dd(0)) where customer_id = pg_temp.cid(24)) = 'active', 'ciclo exige ao menos 15 dias sem comprar';
end $$;

-- ================= oportunidades: gerar, trabalhar, regra desligada =================
do $$
declare org uuid := current_setting('t.org')::uuid; o1 uuid;
begin
  perform public.pv_refresh(org);
  assert (select count(*) from public.reactivation_opportunities where customer_id in (pg_temp.cid(11), pg_temp.cid(13), pg_temp.cid(14), pg_temp.cid(21), pg_temp.cid(30)) and status = 'open') = 5, 'uma oportunidade aberta por cliente em risco/inativo';
  assert not exists (select 1 from public.reactivation_opportunities where customer_id in (pg_temp.cid(12), pg_temp.cid(22), pg_temp.cid(23)) or (customer_id = pg_temp.cid(24) and reason <> 'segment_change')), 'quem está ativo não gera oportunidade por inatividade, ciclo ou queda';
  -- C4 foi «campeões» na rodada de 2 pontuados (R5 F5 M5) e «em risco» na de 5 (R2 F5 M2): a mudança de segmento gera oportunidade, com a explicação
  assert (select explanation_json ->> 'from_segment' || '>' || (explanation_json ->> 'to_segment') from public.reactivation_opportunities where customer_id = pg_temp.cid(24) and reason = 'segment_change') = 'campeoes>em_risco', 'mudança de segmento explicada';
  assert (select estimated_value_cents from public.reactivation_opportunities where customer_id = pg_temp.cid(21)) = 10000, 'valor estimado = ticket mediano (3 compras)';
  assert (select estimated_value_cents from public.reactivation_opportunities where customer_id = pg_temp.cid(11)) is null, 'sem valor estimado com menos de 3 compras';
end $$;

-- estorno e cancelamento desfazem a reativação (R1: 100 dias sem comprar)
do $$
declare org uuid := current_setting('t.org')::uuid; r jsonb; pid uuid; opp uuid;
begin
  select id into opp from public.reactivation_opportunities where customer_id = pg_temp.cid(30);
  r := public.pv_purchase_create(pg_temp.cid(30), 'r1-2', now() + interval '1 minute', 8000);
  pid := (r ->> 'id')::uuid;
  assert (select status from public.reactivation_opportunities where id = opp) = 'reactivated', 'compra depois da identificação reativa a oportunidade';
  perform public.pv_purchase_refund(pid, 3000);
  assert (select status from public.reactivation_opportunities where id = opp) = 'reactivated', 'estorno parcial mantém a reativação';
  perform public.pv_purchase_refund(pid, 5000);
  assert (select status from public.reactivation_opportunities where id = opp) = 'open' and (select reactivated_purchase_id from public.reactivation_opportunities where id = opp) is null, 'estorno total reabre a oportunidade';
  assert not exists (select 1 from public.customer_lifecycle_events where event_type = 'reactivated' and customer_id = pg_temp.cid(30)), 'o evento de reativação também sai';
  assert pg_temp.msg(format('select public.pv_purchase_refund(%L, 1)', pid)) like '%estorno inválido%', 'estorno acima do valor da compra recusado pela regra (não só pela restrição da tabela)';
end $$;

-- oportunidade já trabalhada não é descartada quando a regra deixa de valer; a aberta é
do $$
declare org uuid := current_setting('t.org')::uuid; o1 uuid; o3 uuid;
begin
  select id into o1 from public.reactivation_opportunities where customer_id = pg_temp.cid(11);
  select id into o3 from public.reactivation_opportunities where customer_id = pg_temp.cid(13);
  perform public.pv_opp_action(o1, 'start');
  update public.pv_settings set rule_inactivity = false where organization_id = org;
  assert (select state from public.pv_customer_signals(org, pg_temp.dd(0)) where customer_id = pg_temp.cid(11)) = 'active', 'regra de inatividade desligada não gera sinal';
  perform public.pv_refresh(org);
  assert (select status from public.reactivation_opportunities where id = o1) = 'in_progress', 'oportunidade em andamento não é descartada automaticamente';
  assert (select status from public.reactivation_opportunities where id = o3) = 'discarded' and (select discard_reason from public.reactivation_opportunities where id = o3) = 'A regra deixou de se aplicar.', 'aberta cuja regra deixou de valer é descartada com motivo';
  update public.pv_settings set rule_inactivity = true where organization_id = org;
end $$;

-- ================= reativação: o dia da identificação conta; compra de dia anterior (importada depois) não =================
-- A compra guarda só o DIA (meio-dia). Quem foi identificado hoje NÃO tinha comprado hoje; logo, compra datada de hoje é posterior.
reset role;
do $$
declare org uuid := current_setting('t.org')::uuid;
begin
  insert into public.customers (id, organization_id, name, email) values (pg_temp.cid(80), org, 'D1', 'd1@x.com'), (pg_temp.cid(81), org, 'D2', 'd2@x.com');
  insert into public.purchases (organization_id, customer_id, purchased_at, total_cents, status, external_order_id) values
    (org, pg_temp.cid(80), pg_temp.d(100), 5000, 'completed', 'd1-old'), (org, pg_temp.cid(81), pg_temp.d(100), 5000, 'completed', 'd2-old');
end $$;
:as_a
do $$ begin perform public.pv_refresh(current_setting('t.org')::uuid); end $$;
reset role;
do $$
declare org uuid := current_setting('t.org')::uuid;
begin
  assert (select count(*) from public.reactivation_opportunities where customer_id in (pg_temp.cid(80), pg_temp.cid(81)) and status = 'open') = 2, 'as duas oportunidades nasceram abertas';
  insert into public.purchases (organization_id, customer_id, purchased_at, total_cents, status, external_order_id) values
    (org, pg_temp.cid(80), pg_temp.at(0, time '00:30'), 7000, 'completed', 'd1-hoje'),   -- hoje cedo, ANTES do instante da identificação
    (org, pg_temp.cid(81), pg_temp.d(1), 7000, 'completed', 'd2-ontem');                  -- ontem: anterior à identificação (histórico lançado depois)
  perform private.pv_detect_reactivations(org);
  assert (select status from public.reactivation_opportunities where customer_id = pg_temp.cid(80)) = 'reactivated', 'compra do dia da identificação (mesmo cedo) reconhece a reativação';
  assert (select status from public.reactivation_opportunities where customer_id = pg_temp.cid(81)) = 'open', 'compra de dia anterior à identificação não reativa';
end $$;

-- ================= MFA: administrador sem segundo fator não escreve =================
reset role;
:as_a1
do $$
begin
  assert pg_temp.msg(format('select public.pv_purchase_create(%L, %L, now(), 1000)', pg_temp.cid(2), 'mfa-1')) like '%sem permissão%', 'dono sem MFA (aal1) não registra compra';
end $$;
reset role;

-- ================= importação: limite de linhas =================
:as_a
do $$
declare org uuid := current_setting('t.org')::uuid;
begin
  assert pg_temp.msg(format($q$select public.pv_import_purchases(%L, 'f.csv', null, (select jsonb_agg('{}'::jsonb) from generate_series(1, 2001)), false)$q$, org)) like '%2.000 linhas%', 'compras: mais de 2.000 linhas recusado';
  assert pg_temp.msg(format($q$select public.pv_import_customers(%L, 'f.csv', null, (select jsonb_agg('{}'::jsonb) from generate_series(1, 2001)), false)$q$, org)) like '%2.000 linhas%', 'clientes: mais de 2.000 linhas recusado';
end $$;
reset role;

-- ================= elegibilidade (função direta): supressão por canal e levantada =================
do $$
declare org uuid := current_setting('t.org')::uuid;
begin
  insert into public.customers (id, organization_id, name, email) values (pg_temp.cid(50), org, 'E1', 'e1@x.com'), (pg_temp.cid(51), org, 'E2', 'e2@x.com'), (pg_temp.cid(52), org, 'E3', 'e3@x.com'), (pg_temp.cid(53), org, 'E4', 'e4@x.com');
  insert into public.communication_preferences (organization_id, customer_id, channel, permission_status, legal_basis_reference) values
    (org, pg_temp.cid(50), 'whatsapp', 'granted', 'opt-in'), (org, pg_temp.cid(50), 'email', 'granted', 'opt-in'),
    (org, pg_temp.cid(51), 'whatsapp', 'granted', 'opt-in'), (org, pg_temp.cid(52), 'whatsapp', 'granted', 'opt-in'), (org, pg_temp.cid(53), 'whatsapp', 'granted', 'opt-in');
  assert private.pv_eligibility(pg_temp.cid(50), 'whatsapp') is null and private.pv_eligibility(pg_temp.cid(50), 'email') is null, 'com permissão e sem supressão = elegível';
  assert private.pv_eligibility(pg_temp.cid(50), 'phone') = 'sem_permissao_registrada', 'canal sem preferência registrada não é elegível';
  insert into public.suppression_entries (organization_id, customer_id, channel, reason) values (org, pg_temp.cid(50), 'email', 'Descadastro por e-mail');
  assert private.pv_eligibility(pg_temp.cid(50), 'email') = 'suprimido', 'supressão do canal bloqueia o canal';
  assert private.pv_eligibility(pg_temp.cid(50), 'whatsapp') is null, 'supressão de e-mail não bloqueia o WhatsApp';
  insert into public.suppression_entries (organization_id, customer_id, channel, reason) values (org, pg_temp.cid(50), null, 'Pediu para não ser contatado');
  assert private.pv_eligibility(pg_temp.cid(50), 'whatsapp') = 'suprimido', 'supressão geral (todos os canais) bloqueia';
  update public.suppression_entries set lifted_at = now() where customer_id = pg_temp.cid(50);
  assert private.pv_eligibility(pg_temp.cid(50), 'whatsapp') is null and private.pv_eligibility(pg_temp.cid(50), 'email') is null, 'supressão levantada deixa de valer';
end $$;

-- ================= contato manual: público e elegibilidade vigentes no momento do contato =================
do $$
declare org uuid := current_setting('t.org')::uuid; camp uuid := '00000000-0000-4000-8000-0000000000f1';
begin
  insert into public.campaigns (id, organization_id, name, channel, status, observation_days) values (camp, org, 'Camp limites', 'whatsapp', 'running', 30);
  insert into public.campaign_memberships (organization_id, campaign_id, customer_id, status, exclusion_reason) values
    (org, camp, pg_temp.cid(51), 'eligible', null), (org, camp, pg_temp.cid(52), 'excluded', 'permissao_negada');
  -- E2 estava elegível e depois negou o contato: o registro de contato confere de novo
  update public.communication_preferences set permission_status = 'denied' where customer_id = pg_temp.cid(51);
end $$;
:as_a
do $$
declare camp uuid := '00000000-0000-4000-8000-0000000000f1';
begin
  assert pg_temp.msg(format($q$select public.pv_campaign_log_contact(%L, %L, 'contacted')$q$, camp, pg_temp.cid(51))) like '%permissao_negada%', 'permissão negada depois de entrar na campanha bloqueia o contato';
  assert pg_temp.msg(format($q$select public.pv_campaign_log_contact(%L, %L, 'contacted')$q$, camp, pg_temp.cid(52))) like '%fora do público%', 'excluído do público não é contatado, mesmo com permissão válida hoje';
  assert pg_temp.msg(format($q$select public.pv_campaign_log_contact(%L, %L, 'contacted')$q$, camp, pg_temp.cid(53))) like '%fora do público%', 'quem nunca esteve no público não é contatado';
end $$;
reset role;

-- ================= resultado da campanha: sempre depois do PRIMEIRO contato e dentro da janela de 30 dias =================
-- K1: contatos d20 e d5, compra d10 → conta (10 dias após o primeiro contato) · K2: contato d20, compra d25 (antes) → não · K3: contato d60, compra d20 (40 dias) → não · K4: contato d60, compra d35 (25 dias) → conta
do $$
declare org uuid := current_setting('t.org')::uuid; camp uuid := '00000000-0000-4000-8000-0000000000f2'; i int; n int;
begin
  for i in 61..64 loop
    insert into public.customers (id, organization_id, name, email) values (pg_temp.cid(i), org, 'K' || (i - 60), 'k' || i || '@x.com');
  end loop;
  insert into public.campaigns (id, organization_id, name, channel, status, observation_days) values (camp, org, 'Camp resultado', 'phone', 'running', 30);
  insert into public.campaign_contacts (organization_id, campaign_id, customer_id, contact_method, contact_status, contacted_at) values
    (org, camp, pg_temp.cid(61), 'phone', 'contacted', pg_temp.d(20)), (org, camp, pg_temp.cid(61), 'phone', 'responded', pg_temp.d(5)),
    (org, camp, pg_temp.cid(62), 'phone', 'contacted', pg_temp.d(20)),
    (org, camp, pg_temp.cid(63), 'phone', 'contacted', pg_temp.d(60)),
    (org, camp, pg_temp.cid(64), 'phone', 'responded', pg_temp.d(60));
  insert into public.purchases (organization_id, customer_id, purchased_at, total_cents, status, external_order_id) values
    (org, pg_temp.cid(61), pg_temp.d(10), 7000, 'completed', 'k1'), (org, pg_temp.cid(62), pg_temp.d(25), 7000, 'completed', 'k2'),
    (org, pg_temp.cid(63), pg_temp.d(20), 7000, 'completed', 'k3'), (org, pg_temp.cid(64), pg_temp.d(35), 7000, 'completed', 'k4');
  n := private.pv_campaign_sync(camp);
  assert n = 2, format('resultados registrados: %s', n);
  assert (select array_agg(customer_id order by customer_id) from public.campaign_outcomes where campaign_id = camp) = array[pg_temp.cid(61), pg_temp.cid(64)], 'só K1 e K4 recompraram dentro das regras';
  assert private.pv_campaign_sync(camp) = 0, 'sincronizar de novo não duplica resultados';
end $$;

-- ================= período dos indicadores: dia inteiro no fuso da organização =================
do $$
declare org uuid := current_setting('t.org')::uuid;
begin
  insert into public.customers (id, organization_id, name, email) values (pg_temp.cid(70), org, 'J1', 'j1@x.com');
  insert into public.purchases (organization_id, customer_id, purchased_at, total_cents, status, external_order_id) values
    (org, pg_temp.cid(70), pg_temp.at(21, time '23:30'), 1000, 'completed', 'j-a'),   -- véspera do período (23:30 local)
    (org, pg_temp.cid(70), pg_temp.at(20, time '00:30'), 2000, 'completed', 'j-b'),   -- primeiro dia, logo após a meia-noite local
    (org, pg_temp.cid(70), pg_temp.at(10, time '23:30'), 4000, 'completed', 'j-c'),   -- último dia, fim da noite local
    (org, pg_temp.cid(70), pg_temp.at(9, time '00:30'), 8000, 'completed', 'j-d');    -- dia seguinte ao período
end $$;
:as_a
do $$
declare org uuid := current_setting('t.org')::uuid; k record;
begin
  select * into k from public.pv_kpis(org, pg_temp.dd(20), pg_temp.dd(10));
  -- no intervalo (d20..d10) caem: C4 (d14, d12, d10 = 3 × 10000), K1 (d10 = 7000), K3 (d20 = 7000) e as duas de J1 (2000 + 4000) → 7 pedidos, 50000 centavos.
  -- fora: j-a (23:30 do dia anterior) e j-d (00:30 do dia seguinte), que erros de fuso ou de limite incluiriam.
  assert k.orders = 7 and k.revenue_cents = 50000, format('período 20→10 dias atrás: %s pedidos, %s centavos (esperado 7 e 50000)', k.orders, k.revenue_cents);
end $$;
reset role;

rollback;
select 'PASS 64_pv_boundaries' as result;
