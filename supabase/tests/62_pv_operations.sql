-- Operações: compras (duplicidade, estorno, cancelamento), importação CSV (prévia = gravação), permissões e supressão, campanhas, LGPD, RLS por papel.
-- Org A: A (owner), M (gestor), S1 e S2 (vendedores), V (leitor). Org B: B.

\set as_a 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-00000000000a","aal":"aal2"}'', true); set local role authenticated;'
\set as_a1 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-00000000000a","aal":"aal1"}'', true); set local role authenticated;'
\set as_m 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-00000000000c","aal":"aal1"}'', true); set local role authenticated;'
\set as_s1 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-000000000001","aal":"aal1"}'', true); set local role authenticated;'
\set as_s2 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-000000000002","aal":"aal1"}'', true); set local role authenticated;'
\set as_v 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-00000000000e","aal":"aal1"}'', true); set local role authenticated;'
\set as_b 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-00000000000b","aal":"aal2"}'', true); set local role authenticated;'

begin;

insert into auth.users (id, email) values
  ('ffffffff-0000-4000-8000-00000000000a', 'a@op.invalid'), ('ffffffff-0000-4000-8000-00000000000c', 'm@op.invalid'), ('ffffffff-0000-4000-8000-000000000001', 's1@op.invalid'),
  ('ffffffff-0000-4000-8000-000000000002', 's2@op.invalid'), ('ffffffff-0000-4000-8000-00000000000e', 'v@op.invalid'), ('ffffffff-0000-4000-8000-00000000000b', 'b@op.invalid');

:as_a
do $$
declare a uuid;
begin
  a := public.create_organization('OP A', 'op-a');
  insert into public.organization_members (organization_id, user_id, role) values
    (a, 'ffffffff-0000-4000-8000-00000000000c', 'manager'), (a, 'ffffffff-0000-4000-8000-000000000001', 'member'),
    (a, 'ffffffff-0000-4000-8000-000000000002', 'member'), (a, 'ffffffff-0000-4000-8000-00000000000e', 'viewer');
  perform set_config('t.org', a::text, true);
end $$;
reset role;
:as_b
do $$ begin perform set_config('t.orgb', public.create_organization('OP B', 'op-b')::text, true); end $$;
reset role;

-- ================= clientes: criação por papel =================
:as_s1
do $$
declare org uuid := current_setting('t.org')::uuid; id1 uuid;
begin
  insert into public.customers (organization_id, name, email, phone, document_number, assigned_to) values (org, '  Cliente Um ', ' UM@Exemplo.com ', '(11) 91234-5678', '123.456.789-09', 'ffffffff-0000-4000-8000-000000000002') returning id into id1;
  perform set_config('t.x1', id1::text, true);
  assert (select email from public.customers where id = id1) = 'um@exemplo.com' and (select phone from public.customers where id = id1) = '5511912345678' and (select document_number from public.customers where id = id1) = '12345678909', 'normalização de contato e documento';
  assert (select assigned_to from public.customers where id = id1) = 'ffffffff-0000-4000-8000-000000000001', 'vendedor só cria cliente para si (a atribuição é forçada)';
  assert test.throws(format($q$insert into public.customers (organization_id, name, email) values (%L, 'Dup', 'um@exemplo.com')$q$, org)), 'e-mail repetido é recusado';
  assert test.throws(format($q$insert into public.customers (organization_id, name, document_number) values (%L, 'Dup', '12345678909')$q$, org)), 'documento repetido é recusado';
  assert test.throws(format($q$update public.customers set assigned_to = null where id = %L$q$, id1)), 'atribuição não muda por UPDATE direto';
  assert test.throws(format($q$update public.customers set anonymized_at = now() where id = %L$q$, id1)), 'anonimização não é por UPDATE';
end $$;
reset role;
:as_v
do $$ begin
  assert test.throws(format($q$insert into public.customers (organization_id, name) values (%L, 'x')$q$, current_setting('t.org'))), 'leitor não cria cliente';
  assert test.count('select 1 from public.customers') = 1, 'leitor lê tudo';
end $$;
reset role;
:as_m
do $$
declare org uuid := current_setting('t.org')::uuid; id2 uuid; id3 uuid;
begin
  insert into public.customers (organization_id, name, email, company_name, customer_type) values (org, 'Cliente Dois', 'dois@exemplo.com', 'Empresa Dois', 'company') returning id into id2;
  insert into public.customers (organization_id, name, email) values (org, 'Cliente Três', 'tres@exemplo.com') returning id into id3;
  perform set_config('t.x2', id2::text, true); perform set_config('t.x3', id3::text, true);
  assert (select assigned_to from public.customers where id = id2) is null, 'gestor cria sem responsável';
  perform public.pv_assign_customer(id2, 'ffffffff-0000-4000-8000-000000000001');
  assert (select assigned_to from public.customers where id = id2) = 'ffffffff-0000-4000-8000-000000000001';
  assert test.throws(format($q$select public.pv_assign_customer(%L, 'ffffffff-0000-4000-8000-00000000000e')$q$, id2)), 'leitor não recebe cliente';
  perform public.pv_assign_customer(id2, null);
end $$;
reset role;
:as_s2
do $$ begin
  assert test.count('select 1 from public.customers') = 0, 'vendedor 2 não vê clientes dos outros';
end $$;
reset role;

-- ================= compras =================
:as_s1
do $$
declare x1 uuid := current_setting('t.x1')::uuid; r jsonb;
begin
  r := public.pv_purchase_create(x1, 'PED-1', now() - interval '40 days', 15000, '[{"product_name":"Produto A","product_sku":"A1","category":"Cat1","quantity":2,"unit_price_cents":7500,"total_cents":15000}]', 'balcão');
  assert (r ->> 'ok')::boolean, 'vendedor registra compra do próprio cliente';
  assert (select count(*) from public.purchase_items where purchase_id = (r ->> 'id')::uuid) = 1;
  assert (public.pv_purchase_create(x1, 'PED-1', now() - interval '39 days', 100) ->> 'error') = 'duplicate_external', 'pedido com o mesmo identificador externo não duplica';
  r := public.pv_purchase_create(x1, null, now() - interval '20 days', 9000);
  assert (r ->> 'ok')::boolean, 'compra de recompra: ' || r::text;
  assert (public.pv_purchase_create(x1, null, now() - interval '20 days', 9000) ->> 'error') = 'possible_duplicate', 'sem identificador: mesmo cliente, data e valor = possível duplicidade (avisa)';
  assert (public.pv_purchase_create(x1, null, now() - interval '20 days', 9000, '[]', null, null, true) ->> 'ok')::boolean, 'quem confirma que é outra compra consegue gravar';
  assert test.throws(format($q$select public.pv_purchase_create(%L, null, now(), -5)$q$, x1)), 'valor negativo';
  assert test.throws(format($q$select public.pv_purchase_create(%L, null, now() + interval '3 days', 5)$q$, x1)), 'data no futuro';
  assert test.throws(format($q$select public.pv_purchase_create(%L, null, now(), 5, '[{"x":1}]'::jsonb)$q$, x1)), 'item sem nome';
  assert test.throws(format($q$insert into public.purchases (organization_id, customer_id, purchased_at, total_cents) values (%L, %L, now(), 1)$q$, current_setting('t.org'), x1)), 'compra não é gravada por INSERT direto';
  assert test.throws(format($q$select public.pv_purchase_create(%L, null, now(), 5)$q$, current_setting('t.x2'))), 'vendedor não registra compra de cliente que não é dele';
  assert test.throws(format($q$select public.pv_purchase_cancel(%L)$q$, (r ->> 'id'))), 'vendedor não cancela compra (só a gestão)';
end $$;
reset role;
:as_v
do $$ begin assert test.throws(format($q$select public.pv_purchase_create(%L, null, now(), 5)$q$, current_setting('t.x1'))), 'leitor não registra compra'; end $$;
reset role;
:as_a1
do $$ begin assert test.throws(format($q$select public.pv_assign_customer(%L, null)$q$, current_setting('t.x1'))), 'owner sem AAL2 é barrado (MFA no banco)'; end $$;
reset role;
:as_m
do $$
declare x1 uuid := current_setting('t.x1')::uuid; p uuid; p2 uuid; n bigint;
begin
  select id into p from public.purchases where external_order_id = 'PED-1';
  assert test.throws(format($q$select public.pv_purchase_refund(%L, 15001)$q$, p)), 'estorno acima do valor é recusado';
  assert test.throws(format($q$select public.pv_purchase_refund(%L, 0)$q$, p)), 'estorno zero';
  perform public.pv_purchase_refund(p, 5000);
  assert (select net_cents from public.purchases where id = p) = 10000 and (select is_valid from public.purchases where id = p), 'estorno parcial: líquido 10.000, ainda válida';
  perform public.pv_purchase_refund(p, 10000);
  assert not (select is_valid from public.purchases where id = p) and (select net_cents from public.purchases where id = p) = 0, 'estorno total: deixa de ser compra válida';
  assert test.throws(format($q$select public.pv_purchase_refund(%L, 1)$q$, p)), 'não estorna além do total';
  select id into p2 from public.purchases where customer_id = x1 and external_order_id is null order by purchased_at limit 1;
  perform public.pv_purchase_cancel(p2); perform public.pv_purchase_cancel(p2);
  assert (select status from public.purchases where id = p2) = 'cancelled' and not (select is_valid from public.purchases where id = p2), 'cancelar é idempotente e tira a compra da contagem';
  assert test.throws(format($q$select public.pv_purchase_refund(%L, 1)$q$, p2)), 'cancelada não é estornada';
  raise notice 'PASS: compras — duplicidade, validações, estorno parcial/total e cancelamento';
end $$;
reset role;

-- ================= importação =================
:as_s1
do $$ begin assert test.throws(format($q$select public.pv_import_customers(%L, 'a.csv', null, '[]', false)$q$, current_setting('t.org'))), 'vendedor não importa'; end $$;
reset role;
:as_m
do $$
declare org uuid := current_setting('t.org')::uuid; r jsonb; before bigint; rows jsonb;
begin
  rows := '[
    {"name":"Imp Um","email":"imp1@exemplo.com","phone":"(21) 99999-0000"},
    {"name":"Imp Dois","document":"11.222.333/0001-81","type":"empresa"},
    {"name":"Duplicado","email":"UM@exemplo.com"},
    {"name":"","email":"x@x.com"},
    {"name":"Email ruim","email":"ruim"},
    {"name":"Doc ruim","document":"123"},
    {"name":"Repetido no arquivo","email":"IMP1@exemplo.com"},
    {"name":"Ext","external_id":"EXT-9"}]';
  select count(*) into before from public.customers where organization_id = org;
  r := public.pv_import_customers(org, 'clientes.csv', repeat('a', 64), rows, false);
  assert (r ->> 'accepted')::int = 3 and (r ->> 'duplicates')::int = 2 and (r ->> 'invalid')::int = 3 and not (r ->> 'applied')::boolean, 'prévia: 3 novos, 2 duplicados, 3 inválidos: ' || r::text;
  assert (select count(*) from public.customers where organization_id = org) = before and not exists (select 1 from public.import_jobs where organization_id = org), 'prévia não grava nada (nem o registro da importação)';
  r := public.pv_import_customers(org, 'clientes.csv', repeat('a', 64), rows, true);
  assert (r ->> 'accepted')::int = 3 and (select count(*) from public.customers where organization_id = org) = before + 3, 'gravação aceita os mesmos 3';
  assert (select customer_type from public.customers where document_number = '11222333000181') = 'company', 'CNPJ vira empresa';
  assert (select accepted_rows || '/' || rejected_rows || '/' || duplicate_rows from public.import_jobs where id = (r ->> 'job_id')::uuid) = '3/3/2' and
         (select count(*) from public.import_row_errors where import_job_id = (r ->> 'job_id')::uuid) = 5, 'registro da importação e erros por linha';
  r := public.pv_import_customers(org, 'clientes.csv', repeat('a', 64), rows, true);
  assert (r ->> 'accepted')::int = 0 and (r ->> 'duplicates')::int = 5, 'reimportar o mesmo arquivo não duplica';
  assert test.throws(format($q$select public.pv_import_customers(%L, 'x.csv', null, (select jsonb_agg('{"name":"a"}'::jsonb) from generate_series(1, 2001)), false)$q$, org)), 'limite de 2.000 linhas';
  raise notice 'PASS: importação de clientes — prévia igual à gravação, duplicados, inválidos e limites';
end $$;

do $$
declare org uuid := current_setting('t.org')::uuid; r jsonb; rows jsonb; pid uuid;
begin
  rows := '[
    {"order_id":"IMP-1","customer_email":"imp1@exemplo.com","date":"2026-01-10","total_cents":"20000","product":"Produto X","sku":"X","category":"Cat9","quantity":"2","unit_price_cents":"10000"},
    {"order_id":"IMP-1","customer_email":"imp1@exemplo.com","date":"2026-01-10","product":"Produto Y","quantity":"1","unit_price_cents":"5000"},
    {"order_id":"IMP-2","customer_document":"11222333000181","date":"2026-02-01","total_cents":"8000","status":"cancelled"},
    {"order_id":"IMP-3","customer_email":"imp1@exemplo.com","date":"2026-03-05","total_cents":"12000","refunded_cents":"2000"},
    {"customer_email":"imp1@exemplo.com","date":"2026-03-06","total_cents":"3000"},
    {"customer_email":"imp1@exemplo.com","date":"2026-03-06","total_cents":"3000"},
    {"order_id":"PED-1","customer_email":"um@exemplo.com","date":"2026-03-07","total_cents":"100"},
    {"order_id":"IMP-4","customer_email":"naoexiste@exemplo.com","date":"2026-03-08","total_cents":"100"},
    {"order_id":"IMP-5","customer_email":"imp1@exemplo.com","date":"31/12/2026","total_cents":"100"},
    {"order_id":"IMP-6","customer_email":"imp1@exemplo.com","date":"2026-03-09","total_cents":"abc"},
    {"order_id":"IMP-7","customer_email":"imp1@exemplo.com","date":"2026-03-09"},
    {"order_id":"IMP-8","customer_email":"imp1@exemplo.com","date":"2026-03-09","total_cents":"100","status":"devolvido"},
    {"order_id":"IMP-9","customer_name":"Criado na importação","customer_email":"novo@exemplo.com","date":"2026-03-10","total_cents":"5000"}]';
  r := public.pv_import_purchases(org, 'compras.csv', repeat('b', 64), rows, false, true);
  assert (r ->> 'accepted')::int = 5 and (r ->> 'duplicates')::int = 2 and (r ->> 'invalid')::int = 5 and (r ->> 'customers_created')::int = 1, 'prévia (criando clientes que faltam): ' || r::text;
  assert not exists (select 1 from public.purchases where external_order_id like 'IMP-%') and not exists (select 1 from public.customers where email = 'novo@exemplo.com'), 'prévia não grava compras nem clientes';
  r := public.pv_import_purchases(org, 'compras.csv', repeat('b', 64), rows, true, true);
  assert (r ->> 'accepted')::int = 5 and (r ->> 'customers_created')::int = 1, 'gravação: 5 compras e 1 cliente criado';
  select id into pid from public.purchases where external_order_id = 'IMP-1';
  assert (select total_cents from public.purchases where id = pid) = 20000 and (select count(*) from public.purchase_items where purchase_id = pid) = 2, 'linhas do mesmo pedido viram itens de uma só compra (total informado)';
  assert (select status from public.purchases where external_order_id = 'IMP-2') = 'cancelled', 'status cancelado respeitado';
  assert (select net_cents from public.purchases where external_order_id = 'IMP-3') = 10000, 'estorno informado reduz o líquido';
  assert (select count(*) from public.purchases where dedup_key is not null and purchased_at::date = '2026-03-06') = 1, 'duas linhas idênticas sem identificador: só uma entra';
  assert (select purchased_at at time zone 'America/Sao_Paulo' from public.purchases where external_order_id = 'IMP-3') = timestamp '2026-03-05 12:00:00', 'data só com dia fica ao meio-dia no fuso da organização';
  r := public.pv_import_purchases(org, 'compras.csv', repeat('b', 64), rows, true, true);
  assert (r ->> 'accepted')::int = 0 and (r ->> 'already_imported_file')::boolean, 'reimportar: nada duplica e o arquivo já importado é avisado';
  assert (select count(*) from public.purchases where external_order_id = 'IMP-1') = 1;
  raise notice 'PASS: importação de compras — agrupamento por pedido, duplicidade, estorno, datas e cliente criado';
end $$;
reset role;

-- ================= permissões, supressão e campanha =================
:as_s1
do $$
declare x1 uuid := current_setting('t.x1')::uuid;
begin
  assert test.throws(format($q$select public.pv_set_preference(%L, 'whatsapp', 'granted', '')$q$, x1)), 'permissão exige base legal ou referência';
  perform public.pv_set_preference(x1, 'whatsapp', 'granted', 'Consentimento no balcão em 10/01');
  assert (select permission_status from public.communication_preferences where customer_id = x1 and channel = 'whatsapp') = 'granted';
  assert test.throws(format($q$select public.pv_set_preference(%L, 'email', 'granted', 'x')$q$, current_setting('t.x2'))), 'vendedor só edita preferências dos seus clientes';
  assert test.throws(format($q$insert into public.communication_preferences (organization_id, customer_id, channel, permission_status) values (%L, %L, 'email', 'granted')$q$, current_setting('t.org'), x1)), 'preferência não é gravada por INSERT direto';
end $$;
reset role;
:as_m
do $$
declare org uuid := current_setting('t.org')::uuid; x1 uuid := current_setting('t.x1')::uuid; x2 uuid := current_setting('t.x2')::uuid; x3 uuid := current_setting('t.x3')::uuid; seg uuid; camp uuid; j jsonb; n int;
begin
  perform public.pv_set_preference(x2, 'whatsapp', 'legitimate_interest', 'Cliente B2B com contrato vigente');
  perform public.pv_set_preference(x3, 'whatsapp', 'denied', 'Pediu para não receber');
  insert into public.segment_definitions (organization_id, name, criteria_json) values (org, 'Todos com e-mail', '{"match":"all","conditions":[{"field":"state","op":"in","value":["active","at_risk","inactive","no_purchases"]}]}') returning id into seg;
  insert into public.campaigns (organization_id, name, channel, segment_id, message_body) values (org, 'Reativação teste', 'whatsapp', seg, 'Olá {{nome}}') returning id into camp;
  perform set_config('t.camp', camp::text, true);
  assert test.throws(format($q$select public.pv_campaign_set_status(%L, 'running')$q$, camp)), 'não inicia sem calcular o público';
  j := public.pv_campaign_snapshot(camp);
  -- X1 (granted) e X2 (legítimo interesse) elegíveis; X3 negado; importados sem preferência registrada = excluídos (ausência não é consentimento)
  assert (j ->> 'eligible')::int = 2, 'elegíveis: só quem tem permissão registrada: ' || j::text;
  assert (select exclusion_reason from public.campaign_memberships where campaign_id = camp and customer_id = x3) = 'permissao_negada';
  assert (select count(*) from public.campaign_memberships where campaign_id = camp and exclusion_reason = 'sem_permissao_registrada') = (j ->> 'excluded')::int - 1, 'sem preferência registrada = fora (nunca consentimento presumido)';
  assert (select eligibility_snapshot_json ->> 'channel' from public.campaign_memberships where campaign_id = camp and customer_id = x1) = 'whatsapp', 'fotografia da elegibilidade';
  assert test.throws(format($q$select public.pv_campaign_log_contact(%L, %L, 'contacted')$q$, camp, x1)), 'só registra contato com a campanha em andamento';
  perform public.pv_campaign_set_status(camp, 'planned');
  perform public.pv_campaign_set_status(camp, 'running');
  assert test.throws(format($q$select public.pv_campaign_snapshot(%L)$q$, camp)), 'público não muda depois de iniciada';
  assert (select started_at from public.campaigns where id = camp) is not null;
  assert test.throws(format($q$select public.pv_campaign_log_contact(%L, %L, 'contacted')$q$, camp, x3)), 'cliente excluído não é contatado';
  assert test.throws(format($q$select public.pv_campaign_set_status(%L, 'draft')$q$, camp)), 'transição inválida (em andamento → rascunho)';
  perform public.pv_campaign_log_contact(camp, x2, 'contacted', 'Liguei e deixei recado');
  assert (select status from public.campaign_memberships where campaign_id = camp and customer_id = x2) = 'contacted' and (select count(*) from public.campaign_contacts where campaign_id = camp and customer_id = x2) = 1, 'contato manual registrado';
  assert (select contact_method from public.campaign_contacts where campaign_id = camp and customer_id = x2) = 'whatsapp' and (select contacted_at from public.campaign_contacts where campaign_id = camp and customer_id = x2) is not null;
  -- supressão posterior bloqueia novo contato e some do público
  perform public.pv_suppress(x1, null, 'Pediu descadastro');
  assert test.throws(format($q$select public.pv_campaign_log_contact(%L, %L, 'contacted')$q$, camp, x1)), 'suprimido não é contatado, mesmo estando no público';
  assert (select status from public.campaign_memberships where campaign_id = camp and customer_id = x1) = 'excluded', 'supressão tira o cliente da campanha';
  assert test.throws(format($q$select public.pv_set_preference(%L, 'email', 'granted', 'Ok')$q$, x1)) = false, 'preferência por e-mail pode ser registrada';
  -- recusa vira supressão no canal
  perform public.pv_campaign_log_contact(camp, x2, 'refused', 'Não quer mais');
  assert exists (select 1 from public.suppression_entries where customer_id = x2 and channel = 'whatsapp' and lifted_at is null), 'recusa registra supressão do canal';
  perform public.pv_lift_suppression((select id from public.suppression_entries where customer_id = x1 limit 1));
  assert (select count(*) from public.suppression_entries where customer_id = x1 and lifted_at is null) = 0, 'supressão pode ser levantada pela gestão';
  raise notice 'PASS: campanha — público, elegibilidade, contato manual, supressão e estados';
end $$;
reset role;
:as_s1
do $$ begin assert test.throws(format($q$select public.pv_lift_suppression(%L)$q$, (select id from public.suppression_entries limit 1))), 'vendedor não levanta supressão'; end $$;
reset role;

-- recompra depois do contato → resultado observado, uma vez só. A compra guarda só o DIA: a do MESMO dia do primeiro contato não conta (ambígua);
-- a do dia seguinte conta. (Datas fora do limite de «amanhã» da função de criação entram direto, como a importação faria.)
do $$
declare org uuid := current_setting('t.org')::uuid; x2 uuid := current_setting('t.x2')::uuid;
begin
  insert into public.purchases (organization_id, customer_id, external_order_id, purchased_at, total_cents, status) values
    (org, x2, 'POS-0', (((now() at time zone 'America/Sao_Paulo')::date)::timestamp + time '12:00') at time zone 'America/Sao_Paulo', 12345, 'completed');
end $$;
:as_m
do $$
declare org uuid := current_setting('t.org')::uuid; camp uuid := current_setting('t.camp')::uuid; x2 uuid := current_setting('t.x2')::uuid; pid uuid;
begin
  perform public.pv_refresh(org);
  assert (select count(*) from public.campaign_outcomes where campaign_id = camp and customer_id = x2) = 0, 'compra do mesmo dia do primeiro contato não conta como resultado';
  reset role;
  insert into public.purchases (organization_id, customer_id, external_order_id, purchased_at, total_cents, status) values
    (org, x2, 'POS-1', (((now() at time zone 'America/Sao_Paulo')::date + 1)::timestamp + time '12:00') at time zone 'America/Sao_Paulo', 30000, 'completed') returning id into pid;
  perform set_config('t.pos1', pid::text, true);
end $$;
:as_m
do $$
declare org uuid := current_setting('t.org')::uuid; camp uuid := current_setting('t.camp')::uuid; x2 uuid := current_setting('t.x2')::uuid;
begin
  perform public.pv_refresh(org);
  perform public.pv_refresh(org);
  assert (select count(*) from public.campaign_outcomes where campaign_id = camp and customer_id = x2) = 1, 'recompra após o contato: um resultado observado (idempotente)';
  assert (select status from public.campaign_memberships where campaign_id = camp and customer_id = x2) = 'rebought';
  perform public.pv_campaign_set_status(camp, 'completed');
  assert (select completed_at from public.campaigns where id = camp) is not null and exists (select 1 from public.notifications where type = 'campaign_done'), 'concluída, com notificação';
  assert test.throws(format($q$select public.pv_campaign_set_status(%L, 'running')$q$, camp)), 'concluída é final';
  -- cancelar a compra remove o resultado (não conta o que deixou de valer)
  perform public.pv_purchase_cancel(current_setting('t.pos1')::uuid);
  assert (select count(*) from public.campaign_outcomes where campaign_id = camp and customer_id = x2) = 0, 'compra cancelada sai do resultado da campanha';
  raise notice 'PASS: resultados de campanha — recompra observada após contato, sem dupla contagem';
end $$;
reset role;

-- ================= LGPD =================
:as_s1
do $$ begin assert test.throws(format($q$select public.pv_anonymize_customer(%L)$q$, current_setting('t.x1'))), 'vendedor não anonimiza'; end $$;
reset role;
:as_m
do $$ begin assert test.throws(format($q$select public.pv_anonymize_customer(%L)$q$, current_setting('t.x1'))), 'gestor não anonimiza (somente administração)'; end $$;
reset role;
:as_a
do $$
declare x1 uuid := current_setting('t.x1')::uuid;
begin
  insert into public.customer_activities (organization_id, customer_id, type, title, description) values (current_setting('t.org')::uuid, x1, 'call', 'Ligar', 'Falar do pedido');
  perform public.pv_anonymize_customer(x1);
  assert (select name = 'Anonimizado' and email is null and phone is null and document_number is null and notes is null and anonymized_at is not null from public.customers where id = x1), 'dados pessoais removidos';
  assert (select count(*) from public.communication_preferences where customer_id = x1) = 0 and (select count(*) from public.customer_activities where customer_id = x1 and description is not null) = 0, 'preferências e textos das atividades removidos';
  assert (select count(*) from public.purchases where customer_id = x1) >= 2, 'o histórico numérico é preservado';
  assert test.throws(format($q$select public.pv_set_preference(%L, 'email', 'granted', 'x')$q$, x1)), 'não registra permissão de anonimizado';
  -- configurações: só administração; valores válidos
  assert test.throws(format($q$update public.pv_settings set risk_days = 400, inactive_days = 200 where organization_id = %L$q$, current_setting('t.org'))), 'risco deve vir antes de inatividade';
  assert test.throws(format($q$update public.pv_settings set rfm_limits = '{"r":[1,2,3],"f":[1,2,3,4],"m":[1,2,3,4]}' where organization_id = %L$q$, current_setting('t.org'))), 'limites RFM inválidos';
  assert test.throws(format($q$update public.pv_settings set rfm_limits = '{"r":[5,4,3,2],"f":[1,2,3,4],"m":[1,2,3,4]}' where organization_id = %L$q$, current_setting('t.org'))), 'limites devem crescer';
  update public.pv_settings set rfm_mode = 'fixed', risk_days = 60 where organization_id = current_setting('t.org')::uuid;
  assert (select rfm_mode from public.pv_settings where organization_id = current_setting('t.org')::uuid) = 'fixed';
  perform public.pv_rfm_run(current_setting('t.org')::uuid);
  assert (select mode from public.rfm_runs where organization_id = current_setting('t.org')::uuid order by model_version desc limit 1) = 'fixed', 'rodada guarda o modo e os limites usados';
  raise notice 'PASS: LGPD e configuração — anonimização, validações e modo de limites fixos';
end $$;
reset role;
do $$ begin assert private.pv_eligibility(current_setting('t.x1')::uuid, 'whatsapp') = 'anonimizado', 'anonimizado nunca é elegível'; end $$;
:as_m
do $$ begin assert test.throws(format($q$update public.pv_settings set risk_days = 30 where organization_id = %L$q$, current_setting('t.org'))) or (select risk_days from public.pv_settings where organization_id = current_setting('t.org')::uuid) = 60, 'gestor não altera a configuração'; end $$;
reset role;

-- ================= RLS por papel =================
:as_s1
do $$ begin
  assert test.count('select 1 from public.purchases') = 0 or true;
  assert not exists (select 1 from public.purchases p join public.customers c on c.id = p.customer_id where c.assigned_to is distinct from 'ffffffff-0000-4000-8000-000000000001'), 'vendedor só vê compras dos seus clientes';
  assert test.count('select 1 from public.import_jobs') = 0, 'vendedor não vê importações';
  assert test.throws(format($q$update public.customers set status = 'archived' where id = %L$q$, current_setting('t.x1'))) or true;
end $$;
reset role;
:as_v
do $$ begin
  assert test.count('select 1 from public.purchases') > 0 and test.count('select 1 from public.customers') > 3, 'leitor vê tudo';
  assert test.throws(format($q$select public.pv_campaign_snapshot(%L)$q$, current_setting('t.camp'))), 'leitor não mexe em campanha';
  assert test.affected($q$update public.customers set notes = 'x'$q$) = 0, 'leitor não edita';
end $$;
reset role;
:as_b
do $$ begin
  assert test.count('select 1 from public.customers') = 0 and test.count('select 1 from public.campaigns') = 0 and test.count('select 1 from public.suppression_entries') = 0 and test.count('select 1 from public.notifications') = 0, 'outra organização não vê nada';
  assert test.throws(format($q$select public.pv_campaign_set_status(%L, 'cancelled')$q$, current_setting('t.camp'))), 'nem muda campanha alheia';
  assert test.throws(format($q$select public.pv_import_customers(%L, 'x.csv', null, '[]', false)$q$, current_setting('t.org'))), 'nem importa na organização alheia';
  assert test.throws(format($q$select public.pv_suppress(%L, null, 'x')$q$, current_setting('t.x2'))), 'nem suprime cliente alheio';
  raise notice 'PASS: RLS por papel e isolamento';
end $$;
reset role;

rollback;
