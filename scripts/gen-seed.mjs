#!/usr/bin/env node
// Gera supabase/seed.sql (dados de DEMONSTRAÇÃO, fictícios e determinísticos). Rode: node scripts/gen-seed.mjs
// Aqui nascem só os fatos: clientes, compras, preferências de contato e a história de reativações e campanhas.
// As NOTAS RFM, os segmentos, o estado de risco, as oportunidades e a prioridade são calculados dentro do banco
// pelas mesmas funções do sistema (pv_rfm_run, pv_refresh). Nenhum número do painel é digitado à mão.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// ----------------------------------------------------------------- gerador pseudoaleatório determinístico (LCG)
let seed = 20261013;
const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = (list) => list[Math.floor(rnd() * list.length)];
const chance = (p) => rnd() < p;
const sq = (s) => (s === null || s === undefined ? 'null' : `'${String(s).replace(/'/g, "''")}'`);
const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');

const FIRST = ['Ana', 'Bruno', 'Carla', 'Daniel', 'Elisa', 'Fábio', 'Gabriela', 'Henrique', 'Isabela', 'João', 'Karina', 'Leonardo', 'Mariana', 'Nelson', 'Olívia', 'Paulo', 'Queila', 'Rodrigo', 'Sabrina', 'Tiago', 'Úrsula', 'Vítor', 'Wanda', 'Xavier', 'Yara', 'Zeca'];
const LAST = ['Almeida', 'Barros', 'Cardoso', 'Duarte', 'Esteves', 'Ferraz', 'Gomes', 'Hernandes', 'Ito', 'Junqueira', 'Klein', 'Lopes', 'Macedo', 'Nogueira', 'Oliveira', 'Prado', 'Queiroz', 'Ramos', 'Siqueira', 'Teixeira'];
const BIZ = ['Mercearia', 'Empório', 'Padaria', 'Restaurante', 'Cafeteria', 'Mini Mercado', 'Pousada', 'Lanchonete'];
const BIZ_NAME = ['Boa Vista', 'Do Vale', 'Central', 'Estrela', 'Bela Flor', 'Sol Nascente', 'Grão de Ouro', 'Recanto', 'Esquina', 'Pão Quente', 'Horizonte', 'Campestre'];

// catálogo fictício: produto, categoria, preço (centavos)
const CATALOG = [
  ['Café torrado 500g', 'Café e chás', 2890], ['Café em grãos 1kg', 'Café e chás', 5490], ['Chá de ervas 20 sachês', 'Café e chás', 1290], ['Cápsulas de café (caixa)', 'Café e chás', 3990],
  ['Açúcar refinado 5kg', 'Mercearia', 2590], ['Farinha de trigo 5kg', 'Mercearia', 2290], ['Azeite extra virgem 500ml', 'Mercearia', 4290], ['Arroz tipo 1 5kg', 'Mercearia', 2790], ['Feijão carioca 1kg', 'Mercearia', 890],
  ['Detergente 5L', 'Limpeza', 1890], ['Desinfetante 5L', 'Limpeza', 2190], ['Saco de lixo 100L (pacote)', 'Limpeza', 1590],
  ['Sabonete líquido 5L', 'Higiene', 3290], ['Papel higiênico (fardo)', 'Higiene', 4890], ['Papel toalha (fardo)', 'Higiene', 3790],
  ['Copos descartáveis (caixa)', 'Descartáveis', 2490], ['Embalagem para viagem (pacote)', 'Descartáveis', 1990], ['Guardanapos (fardo)', 'Descartáveis', 1490],
];

// ----------------------------------------------------------------- arquétipos de cliente (a distribuição vem daqui; a classificação, do motor)
const ARCH = [
  { key: 'campeao', n: 12, gap: [18, 30], last: [1, 14], ticket: [60000, 240000], tenure: [380, 540], items: [2, 4], pref: 0.95 },
  { key: 'fiel', n: 34, gap: [30, 55], last: [2, 40], ticket: [25000, 90000], tenure: [250, 520], items: [1, 3], pref: 0.9 },
  { key: 'novo', n: 20, gap: null, last: [1, 28], ticket: [8000, 60000], tenure: [1, 28], items: [1, 3], pref: 0.8, singles: true },
  { key: 'promissor', n: 18, gap: [8, 20], last: [3, 20], ticket: [10000, 50000], tenure: [30, 80], items: [1, 2], pref: 0.85, maxN: 3 },
  { key: 'atencao', n: 30, gap: [60, 120], last: [45, 85], ticket: [5000, 40000], tenure: [200, 480], items: [1, 2], pref: 0.7 },
  { key: 'risco', n: 30, gap: [30, 60], last: [95, 170], ticket: [15000, 80000], tenure: [300, 520], items: [1, 3], pref: 0.85, minN: 4 },
  { key: 'ciclo', n: 8, gap: [14, 21], last: [40, 70], ticket: [12000, 60000], tenure: [200, 400], items: [1, 3], pref: 0.9, minN: 5 },
  { key: 'inativo', n: 24, gap: [40, 90], last: [200, 520], ticket: [8000, 60000], tenure: [250, 540], items: [1, 2], pref: 0.6, maxN: 6 },
  { key: 'sem_compras', n: 8, gap: null, last: null, ticket: null, tenure: null, items: [0, 0], pref: 0.4 },
  // clientes que já estiveram em risco/inativos e voltaram (a história de reativações do painel)
  { key: 'reativado', n: 22, gap: [30, 50], last: null, ticket: [20000, 90000], tenure: [330, 540], items: [1, 3], pref: 0.95, story: true },
];

const customers = [];
const purchases = [];
let orderSeq = 1;
let custSeq = 1;
const stories = [];

function makeItems(range, ticket) {
  const n = int(range[0], range[1]);
  const items = [];
  for (let k = 0; k < n; k += 1) {
    const [name, category, price] = pick(CATALOG);
    const qty = int(1, 4);
    items.push({ name, category, qty, unit: price, total: price * qty });
  }
  const sum = items.reduce((s, x) => s + x.total, 0);
  // o total do pedido acompanha os itens, ajustado ao porte do cliente
  const target = int(ticket[0], ticket[1]);
  const factor = Math.max(1, Math.round(target / Math.max(sum, 1)));
  return { items: items.map((x) => ({ ...x, qty: x.qty * factor, total: x.total * factor })), total: sum * factor };
}

function addPurchase(ci, ago, arch, opts = {}) {
  const { items, total } = arch.items[1] === 0 ? { items: [], total: int(arch.ticket[0], arch.ticket[1]) } : makeItems(arch.items, arch.ticket);
  const draw = rnd();
  const cancelled = !opts.safe && draw < 0.03;
  const refund = !cancelled && !opts.safe && draw >= 0.03 && draw < 0.06 ? Math.round(total * (draw < 0.045 ? 1 : 0.3)) : 0;
  purchases.push({ ci, ago, total, items, ord: opts.ord ?? `PED-${String(orderSeq++).padStart(5, '0')}`, status: cancelled ? 'cancelled' : 'completed', refunded: refund });
}

for (const arch of ARCH) {
  for (let k = 0; k < arch.n; k += 1) {
    const i = custSeq++;
    const company = chance(0.7);
    const first = pick(FIRST);
    const last = pick(LAST);
    const biz = `${pick(BIZ)} ${pick(BIZ_NAME)}`;
    const name = company ? biz : `${first} ${last}`;
    const contactName = `${first} ${last}`;
    const base = slug(company ? biz : `${first}${last}`);
    const c = {
      i, arch: arch.key, name, contact: contactName, company: company ? biz : null, type: company ? 'company' : 'person',
      email: chance(0.92) ? `${base}${i}@exemplo-demo.invalid` : null, phone: chance(0.88) ? `55119${String(int(10000000, 99999999))}` : null,
      doc: chance(0.55) ? (company ? String(int(10, 99)) + String(int(10000000, 99999999)) + '0001' : String(int(10000000000, 99999999999))) : null,
      ext: `CLI-${String(1000 + i)}`, seller: pick([1, 2, 2, 0, 1]), created: arch.tenure ? Math.max(arch.tenure[1] + int(5, 60), 30) : int(5, 200),
      pref: chance(arch.pref),
    };
    customers.push(c);

    if (arch.key === 'sem_compras') continue;
    if (arch.story) {
      // história: compra regular até (T + folga), identificação em T, nova compra 3–26 dias depois; metade com contato de campanha antes da compra
      const identified = int(40, 130);
      const buyAgo = identified - int(3, 26);
      const histStart = identified + int(60, 330);
      const gapBefore = int(...arch.gap);
      for (let ago = identified + gapBefore; ago <= histStart + 60 && ago < 540; ago += int(...arch.gap)) addPurchase(i, ago, arch);
      const ord = `PED-R${String(i).padStart(4, '0')}`;
      const arch2 = { ...arch, items: arch.items };
      addPurchase(i, buyAgo, arch2, { ord, safe: true });
      stories.push({ i, identified, buyAgo, ord, withCampaign: chance(0.5), discard: false });
      continue;
    }
    if (arch.singles) {
      const n = chance(0.7) ? 1 : 2;
      const last = int(...arch.last);
      addPurchase(i, last, arch);
      if (n === 2) addPurchase(i, Math.min(27, last + int(5, 15)), arch);
      continue;
    }
    // compras regulares, da mais recente para trás, dentro da permanência
    const lastAgo = int(...arch.last);
    const tenure = Math.min(int(...arch.tenure), 540);
    let ago = lastAgo;
    let count = 0;
    const maxN = arch.maxN ?? 99;
    const minN = arch.minN ?? 1;
    while (ago <= tenure && count < maxN) {
      addPurchase(i, ago, arch, { safe: count === 0 });
      count += 1;
      ago += int(...arch.gap);
    }
    while (count < minN && ago < 540) { addPurchase(i, ago, arch); count += 1; ago += int(...arch.gap); }
  }
}

// alguns clientes tiveram a oportunidade descartada (história)
const discards = [{ i: customers.find((c) => c.arch === 'inativo').i, ago: 95, reason: 'Cliente encerrou a atividade.' }, { i: customers.filter((c) => c.arch === 'inativo')[3].i, ago: 80, reason: 'Mudou para outra cidade.' }];

// ----------------------------------------------------------------- SQL
const custRows = customers.map((c) => `(${c.i}, ${sq(c.name)}, ${sq(c.email)}, ${sq(c.phone)}, ${sq(c.doc)}, ${sq(c.company)}, ${sq(c.type)}, ${sq(c.ext)}, ${c.seller}, ${c.created}, ${c.pref ? 'true' : 'false'}, ${sq(c.arch)})`);
const purRows = purchases.map((p) => `(${p.ci}, ${p.ago}, ${p.total}, ${sq(p.ord)}, ${sq(p.status)}, ${p.refunded}, ${sq(JSON.stringify(p.items.map((x) => ({ n: x.name, c: x.category, q: x.qty, u: x.unit, t: x.total }))))}::jsonb)`);
const storyRows = stories.map((s) => `(${s.i}, ${s.identified}, ${s.buyAgo}, ${sq(s.ord)}, ${s.withCampaign ? 'true' : 'false'})`);
const discardRows = discards.map((d) => `(${d.i}, ${d.ago}, ${sq(d.reason)})`);

const sql = `-- ARQUIVO GERADO por scripts/gen-seed.mjs — NÃO edite à mão. Dados de DEMONSTRAÇÃO, fictícios e determinísticos.
-- Usuários de demonstração (senha local: DemoLocal#2026): dono@, gerente@, vendedor1@, vendedor2@ e leitor@demo.exemplo.
-- Só valem em ambiente local/demonstração; nunca use este seed em produção.
create or replace function pg_temp.d(n int, t time default time '12:00') returns timestamptz language sql stable as $f$
  select (((now() at time zone 'America/Sao_Paulo')::date - n)::timestamp + t) at time zone 'America/Sao_Paulo' $f$;

create temp table seed_c (i int, name text, email text, phone text, doc text, company text, type text, ext text, seller int, created int, pref boolean, arch text) on commit drop;
create temp table seed_p (ci int, ago int, total bigint, ord text, status text, refunded bigint, items jsonb) on commit drop;
create temp table seed_s (ci int, identified int, buy_ago int, ord text, with_campaign boolean) on commit drop;
create temp table seed_x (ci int, ago int, reason text) on commit drop;

insert into seed_c values
  ${custRows.join(',\n  ')};
insert into seed_p values
  ${purRows.join(',\n  ')};
insert into seed_s values
  ${storyRows.join(',\n  ')};
insert into seed_x values
  ${discardRows.join(',\n  ')};

do $seed$
declare
  org uuid := 'c5c5c5c5-0000-4000-8000-000000000001';
  u_dono uuid := 'c5c5c5c5-0000-4000-8000-0000000000a1';
  u_ger uuid := 'c5c5c5c5-0000-4000-8000-0000000000a2';
  u_v1 uuid := 'c5c5c5c5-0000-4000-8000-0000000000a3';
  u_v2 uuid := 'c5c5c5c5-0000-4000-8000-0000000000a4';
  u_leitor uuid := 'c5c5c5c5-0000-4000-8000-0000000000a5';
  pw text := extensions.crypt('DemoLocal#2026', extensions.gen_salt('bf'));
  camp1 uuid := 'c5c5c5c5-0000-4000-8000-00000000c001';
  camp2 uuid := 'c5c5c5c5-0000-4000-8000-00000000c002';
  camp3 uuid := 'c5c5c5c5-0000-4000-8000-00000000c003';
  seg_risk uuid; seg_inactive uuid; seg_champ uuid; seg_custom uuid;
  claims text;
begin
  if exists (select 1 from public.organizations where id = org) then
    return; -- já semeado
  end if;

  -- ---------------------------------------------------------------- usuários (login por e-mail e senha)
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
  select '00000000-0000-0000-0000-000000000000', v.id, 'authenticated', 'authenticated', v.email, pw, now(),
         '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('full_name', v.nome), now(), now(), '', '', '', ''
  from (values (u_dono, 'dono@demo.exemplo', 'Marina Proprietária'), (u_ger, 'gerente@demo.exemplo', 'Rafael Gestor'),
               (u_v1, 'vendedor1@demo.exemplo', 'Camila Vendas'), (u_v2, 'vendedor2@demo.exemplo', 'Diego Vendas'),
               (u_leitor, 'leitor@demo.exemplo', 'Lívia Leitora')) as v(id, email, nome);
  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  select gen_random_uuid(), u.id, u.email, jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true), 'email', now(), now(), now()
  from auth.users u where u.id in (u_dono, u_ger, u_v1, u_v2, u_leitor);
  update public.profiles p set full_name = u.raw_user_meta_data ->> 'full_name' from auth.users u where u.id = p.id and u.id in (u_dono, u_ger, u_v1, u_v2, u_leitor);

  -- ---------------------------------------------------------------- organização (configurações, modelos e segmentos nascem por gatilho)
  insert into public.organizations (id, name, slug) values (org, 'Distribuidora Demonstração (dados fictícios)', 'demo');
  insert into public.organization_settings (organization_id, display_name, theme) values (org, 'Distribuidora Demonstração', '{"primary":"#0f766e"}'::jsonb);
  insert into public.organization_members (organization_id, user_id, role) values
    (org, u_dono, 'owner'), (org, u_ger, 'manager'), (org, u_v1, 'member'), (org, u_v2, 'member'), (org, u_leitor, 'viewer');

  -- Carga em massa dos FATOS históricos sem acionar gatilhos (normalização já vem pronta do gerador; auditoria não registra a carga).
  set local session_replication_role = replica;

  insert into public.customers (id, organization_id, name, email, phone, document_number, company_name, customer_type, external_customer_id, assigned_to, created_at, updated_at)
  select ('c5c5c5c5-1000-4000-8000-' || lpad(c.i::text, 12, '0'))::uuid, org, c.name, c.email, c.phone, nullif(regexp_replace(coalesce(c.doc, ''), '\\D', '', 'g'), ''), c.company, c.type, c.ext,
         case c.seller when 1 then u_v1 when 2 then u_v2 else null end, pg_temp.d(c.created), pg_temp.d(c.created)
  from seed_c c;

  insert into public.purchases (id, organization_id, customer_id, external_order_id, purchased_at, total_cents, refunded_cents, status, source, created_at)
  select ('c5c5c5c5-2000-4000-8000-' || lpad(row_number() over (order by p.ci, p.ago desc)::text, 12, '0'))::uuid, org, ('c5c5c5c5-1000-4000-8000-' || lpad(p.ci::text, 12, '0'))::uuid, p.ord,
         pg_temp.d(p.ago, make_time(9 + (p.ci * 7 + p.ago) % 9, (p.ci * 13 + p.ago) % 60, 0)), p.total, p.refunded, p.status::public.pv_purchase_status, 'importação', pg_temp.d(p.ago)
  from seed_p p;

  insert into public.purchase_items (organization_id, purchase_id, product_name, category, quantity, unit_price_cents, total_cents)
  select org, pu.id, it ->> 'n', it ->> 'c', (it ->> 'q')::numeric, (it ->> 'u')::bigint, (it ->> 't')::bigint
  from public.purchases pu join seed_p p on p.ord = pu.external_order_id, jsonb_array_elements(p.items) it where pu.organization_id = org;

  -- linha do tempo: primeira compra e compras seguintes
  insert into public.customer_lifecycle_events (organization_id, customer_id, event_type, event_key, metadata, occurred_at)
  select org, pu.customer_id, case when row_number() over (partition by pu.customer_id order by pu.purchased_at) = 1 then 'first_purchase' else 'purchase' end, 'purchase:' || pu.id,
         jsonb_build_object('purchase_id', pu.id), pu.purchased_at
  from public.purchases pu where pu.organization_id = org and pu.is_valid;

  -- preferências de contato: nem todos têm permissão registrada (ausência NÃO é consentimento)
  insert into public.communication_preferences (organization_id, customer_id, channel, permission_status, legal_basis_reference, updated_at)
  select org, ('c5c5c5c5-1000-4000-8000-' || lpad(c.i::text, 12, '0'))::uuid, 'whatsapp',
         case when c.i % 11 = 0 then 'denied' when c.type = 'company' then 'legitimate_interest' else 'granted' end::public.pv_permission,
         case when c.i % 11 = 0 then 'Pediu para não receber mensagens' when c.type = 'company' then 'Contrato de fornecimento vigente' else 'Opt-in no cadastro da loja' end, pg_temp.d(c.created)
  from seed_c c where c.pref and c.phone is not null;
  insert into public.communication_preferences (organization_id, customer_id, channel, permission_status, legal_basis_reference, updated_at)
  select org, ('c5c5c5c5-1000-4000-8000-' || lpad(c.i::text, 12, '0'))::uuid, 'phone', 'legitimate_interest', 'Relacionamento comercial em andamento', pg_temp.d(c.created)
  from seed_c c where c.pref and c.phone is not null and c.type = 'company';
  insert into public.communication_preferences (organization_id, customer_id, channel, permission_status, legal_basis_reference, updated_at)
  select org, ('c5c5c5c5-1000-4000-8000-' || lpad(c.i::text, 12, '0'))::uuid, 'email', 'granted', 'Opt-in no cadastro da loja', pg_temp.d(c.created)
  from seed_c c where c.pref and c.email is not null and c.i % 3 = 0;
  -- cinco clientes pediram para não ser contatados (lista de supressão)
  insert into public.suppression_entries (organization_id, customer_id, channel, reason, created_at)
  select org, ('c5c5c5c5-1000-4000-8000-' || lpad(c.i::text, 12, '0'))::uuid, null, 'Pediu descadastro por telefone', pg_temp.d(40)
  from seed_c c where c.arch in ('risco', 'inativo', 'atencao') and c.pref and c.i % 29 = 0;

  set local session_replication_role = origin;

  -- ---------------------------------------------------------------- motor: rodada antiga (há 90 dias), rodada atual e análise de risco — tudo pelas funções do sistema
  claims := jsonb_build_object('sub', u_dono, 'aal', 'aal2')::text;
  perform set_config('request.jwt.claims', claims, true);
  perform public.pv_rfm_run(org, ((now() at time zone 'America/Sao_Paulo')::date - 90));
  perform public.pv_rfm_run(org);
  perform public.pv_refresh(org);

  -- Uma oportunidade de inatividade nasce quando o cliente cruza o limite de risco (última compra + dias de risco), não «hoje».
  -- Sem isto, toda a carga teria nascido no dia do seed e a taxa de reativação observada ficaria irreal.
  set local session_replication_role = replica;
  update public.reactivation_opportunities o
     set identified_at = pg_temp.d(greatest(0, (o.explanation_json ->> 'days_since_last')::int - (select s.risk_days from public.pv_settings s where s.organization_id = org)))
   where o.organization_id = org and o.status = 'open' and o.reason = 'inactivity';
  set local session_replication_role = origin;

  -- ---------------------------------------------------------------- história de reativações: oportunidade identificada, compra depois; metade com contato de campanha
  insert into public.reactivation_opportunities (id, organization_id, customer_id, reason, priority, estimated_value_cents, explanation_json, status, assigned_to, identified_at, resolved_at, reactivated_purchase_id, last_contact_at)
  select ('c5c5c5c5-3000-4000-8000-' || lpad(s.ci::text, 12, '0'))::uuid, org, cu.id, 'inactivity', 55 + (s.ci * 7) % 40, null,
         jsonb_build_object('days_since_last', 95 + (s.ci * 5) % 60, 'state', 'at_risk', 'reference_days', 90), 'reactivated', cu.assigned_to, pg_temp.d(s.identified), pu.purchased_at, pu.id,
         case when s.with_campaign then pg_temp.d(s.buy_ago + 3 + s.ci % 9) end
  from seed_s s join public.customers cu on cu.id = ('c5c5c5c5-1000-4000-8000-' || lpad(s.ci::text, 12, '0'))::uuid
  join public.purchases pu on pu.organization_id = org and pu.external_order_id = s.ord;
  insert into public.customer_lifecycle_events (organization_id, customer_id, event_type, event_key, metadata, occurred_at)
  select org, pu.customer_id, 'reactivated', 'react:' || pu.customer_id || ':' || pu.id, jsonb_build_object('purchase_id', pu.id, 'net_cents', pu.net_cents, 'reason', 'inactivity'), pu.purchased_at
  from public.purchases pu join seed_s s on s.ord = pu.external_order_id where pu.organization_id = org;

  insert into public.reactivation_opportunities (organization_id, customer_id, reason, priority, explanation_json, status, identified_at, resolved_at, discard_reason)
  select org, ('c5c5c5c5-1000-4000-8000-' || lpad(x.ci::text, 12, '0'))::uuid, 'inactivity', 45, jsonb_build_object('days_since_last', 190, 'state', 'inactive', 'reference_days', 180), 'discarded', pg_temp.d(x.ago + 3), pg_temp.d(x.ago), x.reason
  from seed_x x
  where not exists (select 1 from public.reactivation_opportunities o where o.customer_id = ('c5c5c5c5-1000-4000-8000-' || lpad(x.ci::text, 12, '0'))::uuid and o.status = 'discarded');

  -- ---------------------------------------------------------------- segmentos e campanhas
  select id into seg_risk from public.segment_definitions where organization_id = org and name = 'Clientes em risco';
  select id into seg_inactive from public.segment_definitions where organization_id = org and name = 'Clientes inativos';
  select id into seg_champ from public.segment_definitions where organization_id = org and name = 'Campeões (RFM)';
  insert into public.segment_definitions (organization_id, name, description, criteria_json, segment_type)
  values (org, 'Compraram café e sumiram há 60 dias ou mais', 'Já compraram da categoria «Café e chás» e estão há 60 dias ou mais sem comprar.',
          '{"match":"all","conditions":[{"field":"category","op":"has","value":"Café e chás"},{"field":"days_since_last","op":"gte","value":60}]}', 'custom') returning id into seg_custom;
  perform public.pv_segment_refresh(seg_risk);
  perform public.pv_segment_refresh(seg_inactive);
  perform public.pv_segment_refresh(seg_champ);
  perform public.pv_segment_refresh(seg_custom);

  set local session_replication_role = replica;
  insert into public.campaigns (id, organization_id, name, description, objective, channel, status, segment_id, message_body, owner_id, observation_days, created_by, scheduled_at, started_at, completed_at, created_at) values
    (camp1, org, 'Volta por cima — clientes em risco', 'Contato por WhatsApp com clientes que ficaram distantes.', 'Recuperar clientes com 3 meses ou mais sem comprar', 'whatsapp', 'completed', seg_risk,
     'Olá, {{primeiro_nome|tudo bem}}! Faz um tempo que não nos falamos. Posso te ajudar com {{produto|a reposição do seu pedido}}? — {{vendedor|equipe}}', u_ger, 30, u_ger, null, pg_temp.d(120), pg_temp.d(75), pg_temp.d(125)),
    (camp2, org, 'Reativação de inativos — ligação', 'Ligação para clientes inativos de maior valor.', 'Entender o motivo da pausa e oferecer reposição', 'phone', 'running', seg_inactive,
     'Roteiro: agradecer a parceria, perguntar o que mudou e oferecer condição de retorno definida pela empresa.', u_ger, 30, u_ger, null, pg_temp.d(12), null, pg_temp.d(14)),
    (camp3, org, 'Café — retomada', 'Campanha em preparação para quem comprava café.', 'Retomar compras de café e chás', 'email', 'draft', seg_custom,
     'Olá, {{nome|cliente}}! Notamos que faz um tempo desde o seu último pedido de {{produto|café}}. — {{vendedor|equipe}}', u_ger, 30, u_ger, null, null, null, pg_temp.d(3));
  set local session_replication_role = origin;

  perform set_config('request.jwt.claims', claims, true);
  -- campanha 1 (concluída): público = quem estava em risco/inativo na época, com permissão; contatos antes das recompras da história
  insert into public.campaign_memberships (organization_id, campaign_id, customer_id, status, exclusion_reason, assigned_to, eligibility_snapshot_json, created_at)
  select org, camp1, cu.id,
         case when exists (select 1 from seed_s s where ('c5c5c5c5-1000-4000-8000-' || lpad(s.ci::text, 12, '0'))::uuid = cu.id and s.with_campaign) then 'rebought' else 'contacted' end::public.pv_member_status,
         null, cu.assigned_to, jsonb_build_object('channel', 'whatsapp', 'permission', 'granted'), pg_temp.d(120)
  from public.customers cu join seed_s s on ('c5c5c5c5-1000-4000-8000-' || lpad(s.ci::text, 12, '0'))::uuid = cu.id where s.with_campaign;
  insert into public.campaign_contacts (organization_id, campaign_id, customer_id, contact_method, contact_status, contacted_by, contacted_at, notes, created_at)
  select org, camp1, ('c5c5c5c5-1000-4000-8000-' || lpad(s.ci::text, 12, '0'))::uuid, 'whatsapp', case when s.ci % 3 = 0 then 'responded' else 'contacted' end::public.pv_contact_status,
         case s.ci % 2 when 0 then u_v1 else u_v2 end, pg_temp.d(s.buy_ago + 3 + s.ci % 9), case when s.ci % 3 = 0 then 'Respondeu e pediu um novo orçamento.' else 'Mensagem enviada pelo vendedor.' end, pg_temp.d(s.buy_ago + 3 + s.ci % 9)
  from seed_s s where s.with_campaign;
  -- e também quem foi contatado e NÃO voltou a comprar (inativos de longa data): o resultado observado não é 100%
  insert into public.campaign_memberships (organization_id, campaign_id, customer_id, status, assigned_to, eligibility_snapshot_json, created_at)
  select org, camp1, cu.id, (case when k.n % 3 = 0 then 'no_response' else 'contacted' end)::public.pv_member_status, cu.assigned_to, jsonb_build_object('channel', 'whatsapp', 'permission', 'legitimate_interest'), pg_temp.d(120)
  from (select c.i, row_number() over (order by c.i) as n from seed_c c where c.arch = 'inativo' and c.pref and c.phone is not null limit 24) k
  join public.customers cu on cu.id = ('c5c5c5c5-1000-4000-8000-' || lpad(k.i::text, 12, '0'))::uuid;
  insert into public.campaign_contacts (organization_id, campaign_id, customer_id, contact_method, contact_status, contacted_by, contacted_at, notes, created_at)
  select org, camp1, ('c5c5c5c5-1000-4000-8000-' || lpad(k.i::text, 12, '0'))::uuid, 'whatsapp', (case when k.n % 3 = 0 then 'no_response' when k.n % 5 = 0 then 'responded' else 'contacted' end)::public.pv_contact_status,
         case k.n % 2 when 0 then u_v1 else u_v2 end, pg_temp.d(100 + (k.n::int % 20)), case when k.n % 3 = 0 then 'Sem retorno até o fim da campanha.' else 'Mensagem enviada pelo vendedor.' end, pg_temp.d(100 + (k.n::int % 20))
  from (select c.i, row_number() over (order by c.i) as n from seed_c c where c.arch = 'inativo' and c.pref and c.phone is not null limit 24) k;
  -- campanha 2 (em andamento): alguns inativos recebem contato; uma recusa vira supressão
  insert into public.campaign_memberships (organization_id, campaign_id, customer_id, status, exclusion_reason, assigned_to, eligibility_snapshot_json, created_at)
  select org, camp2, cu.id, case when e.reason is null then 'eligible' else 'excluded' end::public.pv_member_status, e.reason, cu.assigned_to, jsonb_build_object('channel', 'phone'), pg_temp.d(12)
  from (select m.customer_id, case when not exists (select 1 from public.communication_preferences p where p.customer_id = m.customer_id and p.channel = 'phone') then 'sem_permissao_registrada' end as reason
        from public.segment_memberships m where m.segment_id = seg_inactive limit 30) e
  join public.customers cu on cu.id = e.customer_id;
  insert into public.campaign_contacts (organization_id, campaign_id, customer_id, contact_method, contact_status, contacted_by, contacted_at, notes, created_at)
  select org, camp2, m.customer_id, 'phone', (array['contacted', 'responded', 'no_response'])[1 + (row_number() over (order by m.customer_id))::int % 3]::public.pv_contact_status, u_v1, pg_temp.d(2 + (row_number() over (order by m.customer_id))::int % 8),
         'Ligação registrada pelo vendedor.', pg_temp.d(5)
  from public.campaign_memberships m where m.campaign_id = camp2 and m.status = 'eligible' order by m.customer_id limit 8;
  update public.campaign_memberships m set status = 'contacted' where m.campaign_id = camp2 and exists (select 1 from public.campaign_contacts c where c.campaign_id = camp2 and c.customer_id = m.customer_id);
  perform private.pv_campaign_sync(camp1);
  perform private.pv_campaign_sync(camp2);

  -- ---------------------------------------------------------------- tarefas e acompanhamentos
  insert into public.customer_activities (organization_id, customer_id, user_id, assigned_to, type, title, description, priority, opportunity_id, due_at, completed_at, created_at)
  select org, o.customer_id, u_ger, cu.assigned_to, 'call', 'Ligar para entender a pausa nas compras', 'Oportunidade de prioridade alta.', 'high', o.id,
         case when row_number() over (order by o.priority desc) % 4 = 0 then pg_temp.d(3) else now() + ((row_number() over (order by o.priority desc))::int % 9 + 1) * interval '1 day' end, null, pg_temp.d(5)
  from public.reactivation_opportunities o join public.customers cu on cu.id = o.customer_id where o.organization_id = org and o.status in ('open', 'in_progress') order by o.priority desc limit 14;
  insert into public.customer_activities (organization_id, customer_id, user_id, assigned_to, type, title, description, priority, due_at, completed_at, created_at)
  select org, o.customer_id, u_v1, cu.assigned_to, 'message', 'Enviar mensagem de acompanhamento', 'Registrado após o contato.', 'normal', pg_temp.d(6), pg_temp.d(5), pg_temp.d(8)
  from public.reactivation_opportunities o join public.customers cu on cu.id = o.customer_id where o.organization_id = org and o.status in ('open', 'in_progress') order by o.priority limit 8;
  -- uma oportunidade já em andamento
  update public.reactivation_opportunities set status = 'in_progress', last_contact_at = pg_temp.d(4), next_action = 'Ligar na próxima terça com a condição de reposição.'
   where id = (select id from public.reactivation_opportunities where organization_id = org and status = 'open' order by priority desc limit 1);

  -- análise final: reconhece reativações e gera os avisos internos
  perform public.pv_refresh(org);
  perform set_config('request.jwt.claims', '', true);
end
$seed$;
`;

writeFileSync(join(root, 'supabase', 'seed.sql'), sql);
const valid = purchases.filter((p) => p.status === 'completed').length;
console.log(`seed.sql: ${customers.length} clientes, ${purchases.length} compras (${valid} concluídas), ${stories.length} histórias de reativação.`);
