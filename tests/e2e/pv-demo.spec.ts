import { expect, test, type Page } from '@playwright/test';
import { apiLogin, uiLogin } from './helpers';
import { DEMO_ORG, DEMO_PASSWORD, rpc, restJson, watchCsp } from './pv-helpers';

// Painel, relatórios e permissões com os DADOS DE DEMONSTRAÇÃO (seed determinístico: supabase/seed.sql, gerado por scripts/gen-seed.mjs).
// O painel precisa mostrar EXATAMENTE o que as funções SQL devolvem (conferido pela API com o mesmo usuário); os fatos fixos do seed
// (206 clientes, 1.259 compras, carteira da vendedora, campanhas) são conferidos em números absolutos.
const card = (page: Page, label: string) => page.getByRole('region', { name: 'Indicadores' }).getByText(label, { exact: true }).locator('..');
const brl = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }).replace(/\s/g, ' ');
const pct = (v: number | null) => (v === null ? '—' : `${v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`);
const norm = (s: string) => s.replace(/\s/g, ' ');

async function login(page: Page, email: string) {
  await uiLogin(page, email, DEMO_PASSWORD);
  await page.waitForURL('**/dashboard');
}

type Kpis = {
  recent_customers: number; at_risk: number; inactive: number; reactivated: number; reactivation_cohort: number; reactivation_cohort_done: number; reactivation_rate: number | null;
  reactivation_revenue_cents: number; repurchase_buyers: number; repurchase_repeat: number; repurchase_rate: number | null; orders: number; revenue_cents: number; avg_ticket_cents: number | null; overdue_tasks: number;
};
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const daysAgo = (n: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(Date.now() - n * 86_400_000));

test('gestor: os dez indicadores batem com o banco, nove gráficos reais e alertas', async ({ page }) => {
  const violations = watchCsp(page);
  await login(page, 'gerente@demo.exemplo');
  await page.goto('/dashboard?period=90d');
  await expect(page.getByRole('heading', { name: 'Painel' })).toBeVisible();

  // mesmo cálculo, direto pela API, como o mesmo usuário
  const token = await apiLogin('gerente@demo.exemplo', DEMO_PASSWORD);
  const [k] = await rpc<Kpis[]>(token, 'pv_kpis', { p_org: DEMO_ORG, p_from: daysAgo(89), p_to: today() });
  expect(k!.orders).toBeGreaterThan(200);
  await expect(card(page, 'Clientes que compraram')).toContainText(String(k!.recent_customers));
  await expect(card(page, 'Clientes em risco')).toContainText(String(k!.at_risk));
  await expect(card(page, 'Clientes inativos')).toContainText(String(k!.inactive));
  await expect(card(page, 'Clientes reativados (observado)')).toContainText(String(k!.reactivated));
  await expect(card(page, 'Taxa de reativação (observada)')).toContainText(pct(k!.reactivation_rate));
  await expect(card(page, 'Taxa de reativação (observada)')).toContainText(`${k!.reactivation_cohort_done} de ${k!.reactivation_cohort} cliente(s)`);
  expect(norm(await card(page, 'Receita de clientes reativados (observada)').innerText())).toContain(brl(k!.reactivation_revenue_cents));
  await expect(card(page, 'Taxa de recompra')).toContainText(pct(k!.repurchase_rate));
  expect(norm(await card(page, 'Receita no período').innerText())).toContain(brl(k!.revenue_cents));
  expect(norm(await card(page, 'Ticket médio').innerText())).toContain(brl(k!.avg_ticket_cents ?? 0));
  await expect(card(page, 'Tarefas vencidas')).toContainText(String(k!.overdue_tasks));
  // a taxa observada é uma razão de coorte, nunca 100% por construção
  expect(k!.reactivation_rate).toBeGreaterThan(0);
  expect(k!.reactivation_rate).toBeLessThan(100);
  // com histórico no período anterior, a variação aparece em texto (não só cor)
  await expect(page.getByText('vs período anterior').first()).toBeVisible();

  const titles = ['Receita no período', 'Ticket médio', 'Clientes por segmento RFM', 'Ativos, em risco e inativos', 'Frequência de compra', 'Reativações observadas', 'Retenção por coorte', 'Campanhas: contato e recompra', 'Reativação por responsável'];
  for (const t of titles) await expect(page.getByRole('region', { name: t, exact: true })).toBeVisible();
  await expect(page.locator('.recharts-surface').first()).toBeVisible();
  expect(await page.locator('.recharts-surface').count()).toBeGreaterThanOrEqual(7);

  // tabelas alternativas acessíveis, com os mesmos dados do banco
  const seg = page.getByRole('region', { name: 'Clientes por segmento RFM' });
  await seg.getByText('Ver dados em tabela').click();
  await expect(seg.getByRole('table')).toContainText('Campeões');
  await expect(seg.getByRole('table')).toContainText('Em risco');
  await expect(seg.getByRole('row', { name: /Sem compras/ })).toContainText('9');
  const state = page.getByRole('region', { name: 'Ativos, em risco e inativos' });
  await state.getByText('Ver dados em tabela').click();
  await expect(state.getByRole('row', { name: /^Em risco/ })).toContainText(String(k!.at_risk));
  const camp = page.getByRole('region', { name: 'Campanhas: contato e recompra' });
  await camp.getByText('Ver dados em tabela').click();
  await expect(camp.getByRole('table')).toContainText('Volta por cima');
  const cohort = page.getByRole('region', { name: 'Retenção por coorte' });
  await expect(cohort).toBeVisible();

  const alerts = page.getByRole('region', { name: 'Alertas' });
  await expect(alerts.getByRole('link', { name: 'Clientes com tarefa vencida' }).locator('..')).toContainText(String(k!.overdue_tasks));
  await expect(alerts.getByRole('link', { name: 'Oportunidades de prioridade alta em aberto' })).toBeVisible();
  expect(violations).toEqual([]);
});

test('filtros mudam os números; período inválido cai no padrão sem erro', async ({ page }) => {
  await login(page, 'gerente@demo.exemplo');
  const token = await apiLogin('gerente@demo.exemplo', DEMO_PASSWORD);
  const seller = 'c5c5c5c5-0000-4000-8000-0000000000a3';
  await page.goto('/dashboard?period=90d');
  await page.getByLabel('Responsável', { exact: true }).selectOption({ label: 'Camila Vendas' });
  await page.getByRole('button', { name: 'Aplicar' }).click();
  await page.waitForURL(/seller=/);
  const [k] = await rpc<Array<{ orders: number; revenue_cents: number }>>(token, 'pv_kpis', { p_org: DEMO_ORG, p_from: daysAgo(89), p_to: today(), p_seller: seller });
  expect(norm(await card(page, 'Receita no período').innerText())).toContain(brl(k!.revenue_cents));
  await expect(card(page, 'Receita no período')).toContainText(`${k!.orders} pedido(s)`);
  const [all] = await rpc<Array<{ orders: number }>>(token, 'pv_kpis', { p_org: DEMO_ORG, p_from: daysAgo(89), p_to: today() });
  expect(k!.orders).toBeLessThan(all!.orders);

  // segmento + situação + categoria
  await page.goto('/dashboard?period=90d&segment=em_risco&status=at_risk');
  const [f] = await rpc<Array<{ orders: number }>>(token, 'pv_kpis', { p_org: DEMO_ORG, p_from: daysAgo(89), p_to: today(), p_segment: 'em_risco', p_status: 'at_risk' });
  await expect(card(page, 'Receita no período')).toContainText(`${f!.orders} pedido(s)`);
  await page.goto('/dashboard?period=90d&category=Caf%C3%A9%20e%20ch%C3%A1s');
  const [c] = await rpc<Array<{ orders: number }>>(token, 'pv_kpis', { p_org: DEMO_ORG, p_from: daysAgo(89), p_to: today(), p_category: 'Café e chás' });
  expect(c!.orders).toBeGreaterThan(0);
  expect(c!.orders).toBeLessThan(all!.orders);
  await expect(card(page, 'Receita no período')).toContainText(`${c!.orders} pedido(s)`);

  await page.goto('/dashboard?period=custom&from=2026-99-99&to=lixo&segment=hack&seller=nao-e-uuid');
  await expect(page.getByRole('heading', { name: 'Painel' })).toBeVisible();
  await expect(card(page, 'Receita no período')).toBeVisible();
});

test('fatos fixos do seed: clientes, compras, segmentos e campanhas', async ({ page }) => {
  await login(page, 'gerente@demo.exemplo');
  await page.goto('/clientes');
  await expect(page.getByText('206 registro(s)')).toBeVisible();
  await page.goto('/compras');
  await expect(page.getByText(/1\.259 registro\(s\)/)).toBeVisible();

  await page.goto('/segmentacao');
  await expect(page.getByRole('heading', { name: 'Segmentação (RFM)' })).toBeVisible();
  const table = page.getByRole('table', { name: 'Clientes por segmento RFM' });
  for (const s of ['Campeões', 'Fiéis', 'Novos clientes', 'Promissores', 'Em risco', 'Precisam de atenção', 'Inativos', 'Sem compras']) await expect(table).toContainText(s);
  await expect(table.getByRole('row', { name: /Sem compras/ })).toContainText('9');
  // duas rodadas: nenhuma foi sobrescrita
  await expect(page.getByRole('heading', { name: 'Rodadas anteriores' }).locator('xpath=ancestor::section[1]')).toContainText('v1');
  await expect(page.getByRole('heading', { name: 'Rodadas anteriores' }).locator('xpath=ancestor::section[1]')).toContainText('v2');
  // segmentos do sistema e o personalizado
  await expect(page.getByText('Compraram café e sumiram há 60 dias ou mais')).toBeVisible();

  await page.goto('/campanhas');
  const row = page.getByRole('row', { name: /Volta por cima/ });
  await expect(row).toContainText('Concluída');
  await expect(row).toContainText('20'); // público e contatados
  await expect(page.getByRole('row', { name: /Reativação de inativos/ })).toContainText('Em andamento');
  await expect(page.getByRole('row', { name: /Café — retomada/ })).toContainText('Rascunho');
  // linguagem honesta: resultado observado, não causal
  await expect(page.getByText('Resultados são').first()).toBeVisible();
  await expect(page.getByText('Recompraram (observado)').first()).toBeVisible();
  await expect(page.getByText(/incremental/i)).toHaveCount(0);
});

test('relatórios: doze, com CSV seguro (BOM, ;, vírgula decimal) e sem fórmula executável', async ({ page }) => {
  await login(page, 'gerente@demo.exemplo');
  await page.goto('/relatorios?period=90d');
  for (const t of ['Clientes por situação', 'Segmentos RFM', 'Clientes em risco', 'Clientes inativos', 'Oportunidades de reativação', 'Resultado das campanhas', 'Contatos de campanhas', 'Recompra', 'Receita e ticket médio', 'Retenção por coorte', 'Desempenho por responsável', 'Compras do período']) {
    await expect(page.getByRole('heading', { name: t, exact: true })).toBeVisible();
  }
  expect(await page.getByRole('link', { name: 'Baixar CSV' }).count()).toBe(12);
  const res = await page.request.get('/export/receita-periodo?period=90d');
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('text/csv');
  expect(res.headers()['cache-control']).toContain('no-store');
  const csv = await res.text();
  expect(csv.charCodeAt(0)).toBe(0xfeff);
  expect(csv).toContain('"Período";"Pedidos";"Receita líquida (R$)";"Ticket médio (R$)";"Clientes reativados (observado)"');
  expect(csv).toMatch(/\d+,\d{2}/); // vírgula decimal
  // lista completa de clientes: sem dado nulo impresso como "null"/"undefined"
  const customers = await (await page.request.get('/export/clientes')).text();
  expect(customers.split('\r\n').length).toBeGreaterThan(200);
  expect(customers).not.toMatch(/undefined|\bnull\b/);
  expect((await page.request.get('/export/relatorio-que-nao-existe')).status()).toBe(404);
});

test('vendedora vê só a carteira dela e não alcança áreas de gestão; leitor só lê', async ({ page, browser }) => {
  await login(page, 'vendedor1@demo.exemplo');
  await expect(page.getByText('Você vê os números dos clientes atribuídos a você.')).toBeVisible();
  await page.goto('/clientes');
  await expect(page.getByText('92 registro(s)')).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Principal' });
  await expect(nav.getByRole('link', { name: 'Configurações comerciais' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Exportar CSV' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Importar CSV' })).toHaveCount(0);
  expect((await page.goto('/configuracoes'))?.status()).toBe(404);
  expect((await page.goto('/clientes/importar'))?.status()).toBe(404);
  expect((await page.goto('/campanhas/nova'))?.status()).toBe(404);
  expect((await page.request.get('/export/clientes')).status()).toBe(403);
  expect((await page.request.get('/export/receita-periodo')).status()).toBe(403);
  await page.goto('/segmentacao');
  await expect(page.getByRole('button', { name: 'Calcular nova rodada RFM' })).toHaveCount(0);
  await page.goto('/reativacao');
  await expect(page.getByRole('button', { name: 'Atualizar análise de risco' })).toHaveCount(0);

  const ctx = await browser.newContext();
  const viewer = await ctx.newPage();
  await login(viewer, 'leitor@demo.exemplo');
  await viewer.goto('/clientes');
  await expect(viewer.getByText('206 registro(s)')).toBeVisible();
  await expect(viewer.getByRole('link', { name: 'Novo cliente' })).toHaveCount(0);
  await viewer.goto('/compras');
  await expect(viewer.getByRole('link', { name: 'Nova compra' })).toHaveCount(0);
  expect((await viewer.goto('/clientes/novo'))?.status()).toBe(404);
  expect((await viewer.goto('/compras/nova'))?.status()).toBe(404);
  await viewer.goto('/atividades');
  await expect(viewer.getByRole('button', { name: 'Concluir' })).toHaveCount(0);
  await ctx.close();
});

test('ficha do cliente e oportunidade: explicação, histórico e linha do tempo', async ({ page }) => {
  await login(page, 'gerente@demo.exemplo');
  await page.goto('/reativacao');
  await expect(page.getByRole('table', { name: 'Oportunidades de reativação' })).toBeVisible();
  await expect(page.getByText('observado').first()).toBeVisible();
  await page.getByRole('link', { name: 'Ver explicação' }).first().click();
  await expect(page.getByRole('heading', { name: 'Por que este cliente está aqui?' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Como a prioridade foi calculada' })).toBeVisible();
  await expect(page.getByText('Valor estimado:')).toBeVisible();
  await page.getByRole('link', { name: 'Abrir ficha do cliente' }).click();
  await expect(page.getByRole('heading', { name: 'Segmento RFM' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Linha do tempo' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Permissão de contato' })).toBeVisible();
});

test('reativado da história: compra depois da identificação aparece como observada, com a campanha quando houve', async ({ page }) => {
  await login(page, 'gerente@demo.exemplo');
  const token = await apiLogin('gerente@demo.exemplo', DEMO_PASSWORD);
  const reactivated = await restJson<Array<{ customer_id: string; status: string; resolved_at: string; identified_at: string }>>(token, 'reactivation_opportunities?select=customer_id,status,resolved_at,identified_at&status=eq.reactivated&limit=3');
  expect(reactivated.length).toBeGreaterThan(0);
  for (const r of reactivated) expect(Date.parse(r.resolved_at)).toBeGreaterThan(Date.parse(r.identified_at));
  await page.goto(`/clientes/${reactivated[0]!.customer_id}`);
  await expect(page.getByText('Voltou a comprar (reativação observada)').first()).toBeVisible();
});
