import { expect, test } from '@playwright/test';
import { apiLogin, rest } from './helpers';
import { createCustomerApi, createPurchaseApi, csvBuffer, DEMO_ORG, DEMO_PASSWORD, restJson, rpc, setupOwner, suffix } from './pv-helpers';

const URL = process.env.E2E_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON = process.env.E2E_SUPABASE_ANON_KEY ?? '';
const anonFetch = (path: string, init: RequestInit = {}) => fetch(`${URL}/rest/v1/${path}`, { ...init, headers: { apikey: ANON, 'content-type': 'application/json', ...init.headers } });
const SELLER = 'c5c5c5c5-0000-4000-8000-0000000000a3';
const SELLER2 = 'c5c5c5c5-0000-4000-8000-0000000000a4';
const ZERO = '00000000-0000-0000-0000-000000000000';

test('visitante anônimo: nenhuma tabela, nenhuma função', async () => {
  for (const table of ['customers', 'purchases', 'purchase_items', 'communication_preferences', 'suppression_entries', 'reactivation_opportunities', 'campaigns', 'campaign_contacts', 'campaign_outcomes', 'rfm_runs',
    'customer_rfm_scores', 'customer_lifecycle_events', 'import_jobs', 'import_row_errors', 'segment_definitions', 'message_templates', 'customer_activities', 'notifications', 'pv_settings', 'audit_log', 'organizations']) {
    const res = await anonFetch(`${table}?select=*`);
    const body = await res.text();
    expect(res.ok && body !== '[]', `${table} não pode devolver dados ao anônimo (${res.status} ${body.slice(0, 80)})`).toBe(false);
  }
  expect((await anonFetch('customers', { method: 'POST', body: JSON.stringify({ name: 'x' }) })).ok).toBe(false);
  for (const fn of ['pv_rfm_run', 'pv_refresh', 'pv_kpis', 'pv_series', 'pv_cohorts', 'pv_alerts', 'pv_import_customers', 'pv_import_purchases', 'pv_purchase_create', 'pv_purchase_cancel', 'pv_purchase_refund', 'pv_set_preference',
    'pv_set_preference_bulk', 'pv_suppress', 'pv_lift_suppression', 'pv_anonymize_customer', 'pv_assign_customer', 'pv_campaign_snapshot', 'pv_campaign_set_status', 'pv_campaign_log_contact', 'pv_opp_action',
    'pv_segment_members', 'pv_segment_refresh', 'pv_customer_signals', 'pv_user_labels', 'pv_log_export']) {
    const res = await anonFetch(`rpc/${fn}`, { method: 'POST', body: '{}' });
    expect(res.ok, `${fn} não deve ser executável pelo anônimo (${res.status})`).toBe(false);
  }
});

test('isolamento entre empresas pela API: outra organização não lê, não escreve e não executa nada', async ({ browser }) => {
  const a = await setupOwner(browser, 'pvA');
  const b = await setupOwner(browser, 'pvB');
  const s = suffix();
  const cust = await createCustomerApi(a, `Cliente da A ${s}`, { email: `a.${s}@exemplo.test`, phone: '5511912345678' });
  const purchase = await createPurchaseApi(a, cust, 100, 10000, `ORD-${s}`);
  await rpc(a.token, 'pv_set_preference', { p_customer: cust, p_channel: 'whatsapp', p_status: 'granted', p_basis: 'Opt-in' });
  await rpc(a.token, 'pv_rfm_run', { p_org: a.orgId });

  // B não enxerga nada de A
  for (const table of ['customers', 'purchases', 'communication_preferences', 'rfm_runs', 'customer_rfm_scores', 'segment_definitions', 'message_templates', 'pv_settings', 'customer_lifecycle_events']) {
    const rows = await restJson<unknown[]>(b.token, `${table}?select=*&organization_id=eq.${a.orgId}`);
    expect(rows, `${table} de A visível para B`).toEqual([]);
  }
  for (const [fn, args] of [
    ['pv_purchase_cancel', { p_purchase: purchase }],
    ['pv_purchase_refund', { p_purchase: purchase, p_cents: 100 }],
    ['pv_assign_customer', { p_customer: cust, p_to: null }],
    ['pv_anonymize_customer', { p_customer: cust }],
    ['pv_set_preference', { p_customer: cust, p_channel: 'email', p_status: 'granted', p_basis: 'x' }],
    ['pv_suppress', { p_customer: cust, p_channel: null, p_reason: 'x' }],
    ['pv_rfm_run', { p_org: a.orgId }],
    ['pv_refresh', { p_org: a.orgId }],
    ['pv_set_preference_bulk', { p_org: a.orgId, p_channel: 'whatsapp', p_status: 'granted', p_basis: 'x' }],
    ['pv_import_customers', { p_org: a.orgId, p_file_name: 'x.csv', p_hash: '', p_rows: [{ name: 'Invasor' }], p_apply: true }],
    ['pv_import_purchases', { p_org: a.orgId, p_file_name: 'x.csv', p_hash: '', p_rows: [], p_apply: true }],
    ['pv_log_export', { p_org: a.orgId, p_kind: 'clientes', p_rows: 1 }],
  ] as const) {
    const res = await rest(b.token, `rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) });
    expect(res.ok, `${fn} de outra organização deve falhar`).toBe(false);
  }
  // indicadores de A pedidos por B: recusados (nada de números alheios)
  const today = new Date().toISOString().slice(0, 10);
  for (const fn of ['pv_kpis', 'pv_series', 'pv_frequency_bands']) {
    const res = await rest(b.token, `rpc/${fn}`, { method: 'POST', body: JSON.stringify({ p_org: a.orgId, p_from: today, p_to: today }) });
    expect(res.ok, `${fn} de A pedido por B`).toBe(false);
  }
  expect((await rest(b.token, 'rpc/pv_user_labels', { method: 'POST', body: JSON.stringify({ p_org: a.orgId }) })).ok && (await (await rest(b.token, 'rpc/pv_user_labels', { method: 'POST', body: JSON.stringify({ p_org: a.orgId }) })).json()).length).toBeFalsy();
  // B não cria cliente dentro da organização de A
  expect((await rest(b.token, 'customers', { method: 'POST', body: JSON.stringify({ organization_id: a.orgId, name: 'Invasor' }) })).ok).toBe(false);
  // e os dados de A seguem intactos
  expect(await restJson<Array<{ is_valid: boolean }>>(a.token, `purchases?select=is_valid&id=eq.${purchase}`)).toEqual([{ is_valid: true }]);
  await Promise.all([a.ctx.close(), b.ctx.close()]);
});

test('MFA no banco: dono sem segundo fator (AAL1) não escreve; nem pela API', async ({ browser }) => {
  const owner = await setupOwner(browser, 'mfa');
  const aal1 = await apiLogin(owner.email);
  const cust = await createCustomerApi(owner, `Cliente MFA ${suffix()}`);
  const create = await rest(aal1, 'rpc/pv_purchase_create', { method: 'POST', body: JSON.stringify({ p_customer: cust, p_external: null, p_at: new Date().toISOString(), p_total_cents: 1000, p_items: [], p_source: null, p_notes: null, p_allow_duplicate: true }) });
  expect(create.ok).toBe(false);
  expect(await create.text()).toMatch(/sem permiss/i);
  expect((await rest(aal1, 'customers', { method: 'POST', body: JSON.stringify({ organization_id: owner.orgId, name: 'Sem MFA' }) })).ok).toBe(false);
  expect((await rest(aal1, 'rpc/pv_rfm_run', { method: 'POST', body: JSON.stringify({ p_org: owner.orgId }) })).ok).toBe(false);
  // com AAL2 funciona
  expect((await rest(owner.token, 'customers', { method: 'POST', body: JSON.stringify({ organization_id: owner.orgId, name: 'Com MFA' }) })).ok).toBe(true);
  await owner.ctx.close();
});

test('vendedora: só a carteira dela, sem colunas protegidas, sem funções de gestão; leitor só lê', async () => {
  const seller = await apiLogin('vendedor1@demo.exemplo', DEMO_PASSWORD);
  const manager = await apiLogin('gerente@demo.exemplo', DEMO_PASSWORD);
  const viewer = await apiLogin('leitor@demo.exemplo', DEMO_PASSWORD);

  const mine = await restJson<Array<{ id: string; assigned_to: string }>>(seller, 'customers?select=id,assigned_to');
  expect(mine).toHaveLength(92);
  expect(new Set(mine.map((c) => c.assigned_to))).toEqual(new Set([SELLER]));
  expect(await restJson(seller, `customers?select=id&assigned_to=neq.${SELLER}`)).toEqual([]);
  // tabelas filhas seguem o mesmo corte
  const purchases = await restJson<Array<{ customer_id: string }>>(seller, 'purchases?select=customer_id&limit=1000');
  const mineIds = new Set(mine.map((c) => c.id));
  expect(purchases.length).toBeGreaterThan(0);
  expect(purchases.every((p) => mineIds.has(p.customer_id))).toBe(true);
  expect((await restJson<unknown[]>(seller, 'communication_preferences?select=customer_id&limit=1000')).length).toBeGreaterThan(0);

  const others = await restJson<Array<{ id: string; name: string }>>(manager, `customers?select=id,name&assigned_to=eq.${SELLER2}&limit=1`);
  const other = others[0]!;
  // não altera, não anonimiza, não suprime cliente do colega
  const patch = await rest(seller, `customers?id=eq.${other.id}`, { method: 'PATCH', body: JSON.stringify({ notes: 'invasão' }) });
  expect(await patch.json()).toEqual([]);
  for (const [fn, args] of [
    ['pv_anonymize_customer', { p_customer: other.id }],
    ['pv_suppress', { p_customer: other.id, p_channel: null, p_reason: 'x' }],
    ['pv_set_preference', { p_customer: other.id, p_channel: 'email', p_status: 'granted', p_basis: 'x' }],
    ['pv_assign_customer', { p_customer: other.id, p_to: SELLER }],
    ['pv_purchase_create', { p_customer: other.id, p_external: null, p_at: new Date().toISOString(), p_total_cents: 100, p_items: [], p_source: null, p_notes: null, p_allow_duplicate: true }],
    // funções de gestão
    ['pv_rfm_run', { p_org: DEMO_ORG }],
    ['pv_refresh', { p_org: DEMO_ORG }],
    ['pv_set_preference_bulk', { p_org: DEMO_ORG, p_channel: 'whatsapp', p_status: 'granted', p_basis: 'x' }],
    ['pv_import_customers', { p_org: DEMO_ORG, p_file_name: 'x.csv', p_hash: '', p_rows: [{ name: 'Invasor' }], p_apply: false }],
    ['pv_import_purchases', { p_org: DEMO_ORG, p_file_name: 'x.csv', p_hash: '', p_rows: [], p_apply: false }],
    ['pv_log_export', { p_org: DEMO_ORG, p_kind: 'clientes', p_rows: 1 }],
    ['pv_segment_refresh', { p_segment: ZERO }],
    ['pv_lift_suppression', { p_id: ZERO }],
  ] as const) {
    expect((await rest(seller, `rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) })).ok, `${fn} não é da vendedora`).toBe(false);
  }
  // colunas protegidas e tabelas só-por-função
  for (const col of [{ assigned_to: null }, { anonymized_at: new Date().toISOString() }, { status: 'archived' }, { organization_id: ZERO }]) {
    const res = await rest(seller, `customers?id=eq.${mine[0]!.id}`, { method: 'PATCH', body: JSON.stringify(col) });
    expect(res.ok, `UPDATE direto de ${Object.keys(col)[0]} deve falhar`).toBe(false);
  }
  for (const [table, body] of [
    ['purchases', { organization_id: DEMO_ORG, customer_id: mine[0]!.id, purchased_at: new Date().toISOString(), total_cents: 1 }],
    ['communication_preferences', { organization_id: DEMO_ORG, customer_id: mine[0]!.id, channel: 'email', permission_status: 'granted' }],
    ['suppression_entries', { organization_id: DEMO_ORG, customer_id: mine[0]!.id, reason: 'x' }],
    ['reactivation_opportunities', { organization_id: DEMO_ORG, customer_id: mine[0]!.id, reason: 'inactivity', priority: 99 }],
    ['rfm_runs', { organization_id: DEMO_ORG, model_version: 99, reference_date: '2026-01-01', window_days: 365, mode: 'percentile', params_json: {} }],
    ['campaign_outcomes', { organization_id: DEMO_ORG, campaign_id: ZERO, customer_id: mine[0]!.id, outcome_type: 'rebought', related_purchase_id: ZERO, outcome_at: new Date().toISOString() }],
    ['audit_log', { organization_id: DEMO_ORG, action: 'x', entity: 'x' }],
  ] as const) {
    expect((await rest(seller, table, { method: 'POST', body: JSON.stringify(body) })).ok, `INSERT direto em ${table} deve falhar`).toBe(false);
  }
  // histórico RFM é imutável até para a gestão
  expect((await rest(manager, 'rfm_runs?model_version=eq.1', { method: 'PATCH', body: JSON.stringify({ scored_count: 0 }) })).ok).toBe(false);
  expect((await rest(manager, 'customer_rfm_scores?model_version=eq.1', { method: 'PATCH', body: JSON.stringify({ segment_key: 'campeoes' }) })).ok).toBe(false);
  expect((await rest(manager, 'audit_log?id=gt.0', { method: 'DELETE' })).ok).toBe(false);

  // leitor: lê tudo, não escreve nada
  expect((await restJson<unknown[]>(viewer, 'customers?select=id&limit=1000')).length).toBe(206);
  expect((await rest(viewer, 'customers', { method: 'POST', body: JSON.stringify({ organization_id: DEMO_ORG, name: 'Leitor não cria' }) })).ok).toBe(false);
  expect((await rest(viewer, 'rpc/pv_purchase_create', { method: 'POST', body: JSON.stringify({ p_customer: other.id, p_external: null, p_at: new Date().toISOString(), p_total_cents: 100, p_items: [], p_source: null, p_notes: null, p_allow_duplicate: true }) })).ok).toBe(false);
  expect((await rest(viewer, 'rpc/pv_set_preference', { method: 'POST', body: JSON.stringify({ p_customer: other.id, p_channel: 'email', p_status: 'granted', p_basis: 'x' }) })).ok).toBe(false);
  expect((await rest(viewer, 'customer_activities', { method: 'POST', body: JSON.stringify({ organization_id: DEMO_ORG, customer_id: other.id, type: 'call', title: 'x' }) })).ok).toBe(false);
  // nada do que foi tentado mudou o cliente
  const after = await restJson<Array<{ notes: string | null }>>(manager, `customers?select=notes&id=eq.${other.id}`);
  expect(after[0]!.notes).not.toBe('invasão');
});

test('XSS e CSV hostis são neutralizados; chave de serviço nunca chega ao navegador', async ({ browser }) => {
  const owner = await setupOwner(browser, 'xss');
  const { page } = owner;
  const dialogs: string[] = [];
  page.on('dialog', (d) => { if (d.type() !== 'confirm') dialogs.push(d.message()); void d.dismiss(); });
  const s = suffix();
  const evil = `<img src=x onerror=alert(1)> ${s}`;
  const formula = `=HYPERLINK("http://evil.example","clique") ${s}`;
  const evilId = await createCustomerApi(owner, evil, { company_name: '<script>alert(2)</script>', email: `x.${s}@exemplo.test` });
  await createCustomerApi(owner, formula, { email: `f.${s}@exemplo.test` });
  for (const path of ['/clientes', `/clientes/${evilId}`, '/dashboard', '/segmentacao', '/campanhas', '/atividades']) {
    await page.goto(path);
    await page.waitForLoadState('load');
    await page.waitForTimeout(500);
  }
  await page.goto('/clientes');
  await expect(page.getByRole('table', { name: 'Clientes' })).toContainText('<img src=x onerror=alert(1)>');
  expect(dialogs).toEqual([]);

  // exportação: a fórmula vira texto (apóstrofo), nunca é executada pelo Excel/Sheets
  const csv = await (await page.request.get('/export/clientes')).text();
  expect(csv).toContain(`"'=HYPERLINK(`);
  expect(csv).not.toMatch(/(^|;)"=HYPERLINK/m);

  // varre os scripts carregados nas páginas autenticadas
  const seen = new Set<string>();
  const bodies: string[] = [];
  page.on('response', async (r) => { if (r.url().includes('/_next/static/') && r.url().endsWith('.js') && !seen.has(r.url())) { seen.add(r.url()); bodies.push(await r.text().catch(() => '')); } });
  for (const path of ['/dashboard', '/clientes', '/compras/importar', '/segmentacao', '/campanhas', '/relatorios']) {
    await page.goto(path);
    await page.waitForLoadState('load');
    await page.waitForTimeout(600);
  }
  const all = bodies.join('\n');
  expect(all.length).toBeGreaterThan(50_000);
  expect(all).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY|service_role|sb_secret_|AI_API_KEY/);
  expect(all).not.toContain('c2VydmljZV9yb2xl');
  await owner.ctx.close();
});

test('LGPD: anonimizar remove os dados pessoais, mantém compras e bloqueia novo registro de permissão', async ({ browser }) => {
  const owner = await setupOwner(browser, 'lgpd');
  const { page } = owner;
  const s = suffix();
  const id = await createCustomerApi(owner, `Pessoa Real ${s}`, { email: `real.${s}@exemplo.test`, phone: '5511912345678', document_number: '12345678909', notes: 'dado sensível' });
  await createPurchaseApi(owner, id, 30, 25000);
  await rpc(owner.token, 'pv_set_preference', { p_customer: id, p_channel: 'whatsapp', p_status: 'granted', p_basis: 'Opt-in' });

  await page.goto(`/clientes/${id}`);
  await page.getByRole('button', { name: 'Anonimizar (LGPD)' }).click();
  await expect(page.getByText(/foi anonimizado em/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Anonimizado' })).toBeVisible();
  const row = (await restJson<Array<Record<string, unknown>>>(owner.token, `customers?select=name,email,phone,document_number,company_name,notes,anonymized_at&id=eq.${id}`))[0]!;
  expect(row).toMatchObject({ name: 'Anonimizado', email: null, phone: null, document_number: null, company_name: null, notes: null });
  expect(row.anonymized_at).toBeTruthy();
  // compras e números agregados ficam
  expect(await restJson<unknown[]>(owner.token, `purchases?select=id&customer_id=eq.${id}`)).toHaveLength(1);
  // não há como voltar a registrar permissão nem contato
  const res = await rest(owner.token, 'rpc/pv_set_preference', { method: 'POST', body: JSON.stringify({ p_customer: id, p_channel: 'email', p_status: 'granted', p_basis: 'x' }) });
  expect(res.ok).toBe(false);
  // a exportação não traz mais o nome antigo
  const csv = await (await page.request.get('/export/clientes')).text();
  expect(csv).not.toContain(`Pessoa Real ${s}`);
  expect(csv).not.toContain(`real.${s}@exemplo.test`);
  await owner.ctx.close();
});

test('importação: limites de tamanho, de linhas e de estrutura com mensagem clara', async ({ browser }) => {
  const owner = await setupOwner(browser, 'lim');
  const { page } = owner;
  await page.goto('/clientes/importar');
  const rows = ['Nome;E-mail'];
  for (let i = 0; i < 2001; i += 1) rows.push(`Pessoa ${i};p${i}@exemplo.test`);
  await page.setInputFiles('#import-file', { name: 'muitas.csv', mimeType: 'text/csv', buffer: csvBuffer(rows) });
  await expect(page.getByText(/Muitas linhas \(máximo de 2000 por importação\)/)).toBeVisible();
  await page.setInputFiles('#import-file', { name: 'vazio.csv', mimeType: 'text/csv', buffer: csvBuffer(['so cabecalho']) });
  await expect(page.getByText('O arquivo precisa ter a linha de cabeçalho e ao menos uma linha de dados.')).toBeVisible();
  await page.setInputFiles('#import-file', { name: 'grande.csv', mimeType: 'text/csv', buffer: Buffer.alloc(2_100_000, 'a') });
  await expect(page.getByText('Arquivo muito grande (máximo de 2 MB).')).toBeVisible();
  // sem a coluna de nome, a importação não é liberada e diz o que falta
  await page.setInputFiles('#import-file', { name: 'sem-nome.csv', mimeType: 'text/csv', buffer: csvBuffer(['Telefone;Cidade', '11999990000;SP']) });
  await expect(page.getByText('Escolha a coluna de «Nome».')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Validar sem gravar' })).toBeDisabled();
  // o banco também recusa mais de 2.000 linhas (a tela não é a única barreira)
  const big = Array.from({ length: 2001 }, (_, i) => ({ name: `X${i}` }));
  const res = await rest(owner.token, 'rpc/pv_import_customers', { method: 'POST', body: JSON.stringify({ p_org: owner.orgId, p_file_name: 'x.csv', p_hash: '', p_rows: big, p_apply: false }) });
  expect(res.ok).toBe(false);
  await owner.ctx.close();
});
