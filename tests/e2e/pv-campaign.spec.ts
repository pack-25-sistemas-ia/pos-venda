import { expect, test } from '@playwright/test';
import { rest } from './helpers';
import { createCustomerApi, createPurchaseApi, createPurchaseTomorrowApi, rpc, setupOwner, suffix, watchCsp } from './pv-helpers';

test('campanha de ponta a ponta: elegibilidade por permissão, contato manual, recusa vira supressão e resultado observado', async ({ browser }) => {
  const owner = await setupOwner(browser, 'camp');
  const { page } = owner;
  await owner.ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  const violations = watchCsp(page);
  const s = suffix();

  // cinco clientes sem comprar há 120 dias, com situações de permissão diferentes
  const mk = async (name: string) => {
    const id = await createCustomerApi(owner, `${name} ${s}`, { email: `${name.toLowerCase().replace(/\s/g, '')}.${s}@exemplo.test`, phone: '5511912345678' });
    await createPurchaseApi(owner, id, 120, 40000);
    return id;
  };
  const ana = await mk('Ana Ativa');
  const bia = await mk('Bia Bloqueada');
  const caio = await mk('Caio Sem Registro');
  const davi = await mk('Davi Interesse');
  const eva = await mk('Eva Suprimida');
  const pref = (id: string, status: string, basis: string | null) => rpc(owner.token, 'pv_set_preference', { p_customer: id, p_channel: 'whatsapp', p_status: status, p_basis: basis });
  await pref(ana, 'granted', 'Opt-in no cadastro');
  await pref(bia, 'denied', null);
  await pref(davi, 'legitimate_interest', 'Contrato de fornecimento vigente');
  await pref(eva, 'granted', 'Opt-in no cadastro');
  await rpc(owner.token, 'pv_suppress', { p_customer: eva, p_channel: null, p_reason: 'Pediu descadastro' });
  await rpc(owner.token, 'pv_rfm_run', { p_org: owner.orgId });
  await rpc(owner.token, 'pv_refresh', { p_org: owner.orgId });

  // segmento pela interface
  await page.goto('/segmentacao/segmentos/novo');
  await page.getByLabel('Nome do segmento').fill(`Sumidos ${s}`);
  await page.getByRole('button', { name: 'Criar segmento' }).click();
  await page.waitForURL('**/segmentacao');

  // campanha pela interface
  await page.goto('/campanhas/nova');
  await page.getByLabel('Nome da campanha').fill(`Retomada ${s}`);
  await page.getByLabel('Público (segmento)').selectOption({ label: `Sumidos ${s}` });
  await page.getByLabel('Texto', { exact: true }).fill('Olá, {{primeiro_nome|cliente}}! Faz {{dias_sem_comprar}} dias que não nos falamos. — {{vendedor|equipe}}');
  await page.getByRole('button', { name: 'Criar campanha' }).click();
  await page.waitForURL(/\/campanhas\/[0-9a-f-]{36}$/);
  const campUrl = page.url();
  const campId = campUrl.split('/').pop()!;
  await expect(page.getByText('Rascunho').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Registrar contato' })).toHaveCount(0);

  // o público só inclui quem tem permissão registrada e não está suprimido
  await page.getByRole('button', { name: 'Calcular público' }).click();
  const results = page.getByRole('region', { name: 'Resultados' });
  await expect(results.getByText('No público', { exact: true }).locator('..')).toContainText('2');
  await expect(results.getByText('No público', { exact: true }).locator('..')).toContainText('3 fora do público');
  await page.getByRole('button', { name: /^Fora do público/ }).click();
  await expect(page.getByText('Contato negado pelo cliente')).toBeVisible();
  await expect(page.getByText('Sem permissão de contato registrada')).toBeVisible();
  await expect(page.getByText('Na lista de supressão')).toBeVisible();
  await page.getByRole('button', { name: /^No público/ }).click();
  await expect(page.getByRole('link', { name: `Ana Ativa ${s}` })).toBeVisible();
  await expect(page.getByRole('link', { name: `Davi Interesse ${s}` })).toBeVisible();
  await expect(page.getByRole('link', { name: `Eva Suprimida ${s}` })).toHaveCount(0);

  // contato exige campanha em andamento; depois de iniciada, o público fica congelado
  await page.getByRole('button', { name: 'Iniciar campanha' }).click();
  await expect(page.getByText('Em andamento').first()).toBeVisible();
  const refreshed = await rest(owner.token, 'rpc/pv_campaign_snapshot', { method: 'POST', body: JSON.stringify({ p_campaign: campId }) });
  expect(refreshed.ok).toBe(false);

  // mensagem de apoio renderizada com os dados do cliente (copiar e usar no canal da empresa; o sistema não envia)
  const anaRow = page.getByRole('listitem').filter({ hasText: `Ana Ativa ${s}` });
  await anaRow.getByRole('button', { name: 'Copiar mensagem' }).click();
  await expect(anaRow.getByRole('button', { name: 'Copiado!' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('Olá, Ana! Faz 120 dias que não nos falamos. — equipe');

  // contatos manuais: Ana respondeu; Davi recusou
  await anaRow.getByLabel('Resultado do contato').selectOption('responded');
  await anaRow.getByLabel('Observações').fill('Pediu orçamento.');
  await anaRow.getByRole('button', { name: 'Registrar contato' }).click();
  await expect(anaRow).toContainText('Respondeu');
  const daviRow = page.getByRole('listitem').filter({ hasText: `Davi Interesse ${s}` });
  await daviRow.getByLabel('Resultado do contato').selectOption('refused');
  await daviRow.getByRole('button', { name: 'Registrar contato' }).click();
  await expect(daviRow).toContainText('Recusou');
  // a recusa entrou na lista de supressão do canal e o cliente não pode mais ser contatado
  await page.goto(`/clientes/${davi}`);
  await expect(page.getByText(/WhatsApp.*Recusou contato na campanha/)).toBeVisible();
  const again = await rest(owner.token, 'rpc/pv_campaign_log_contact', { method: 'POST', body: JSON.stringify({ p_campaign: campId, p_customer: davi, p_status: 'contacted', p_notes: null }) });
  expect(again.ok).toBe(false);
  // quem nunca esteve no público também não
  const outsider = await rest(owner.token, 'rpc/pv_campaign_log_contact', { method: 'POST', body: JSON.stringify({ p_campaign: campId, p_customer: caio, p_status: 'contacted', p_notes: null }) });
  expect(outsider.ok).toBe(false);
  const blocked = await rest(owner.token, 'rpc/pv_campaign_log_contact', { method: 'POST', body: JSON.stringify({ p_campaign: campId, p_customer: bia, p_status: 'contacted', p_notes: null }) });
  expect(blocked.ok).toBe(false);

  // resultado observado: compra em dia posterior ao do primeiro contato (a compra guarda só o dia)
  await createPurchaseTomorrowApi(owner, ana, 55000);
  await page.goto('/reativacao');
  await page.getByRole('button', { name: 'Atualizar análise de risco' }).click();
  await page.waitForTimeout(800);
  await page.goto(campUrl);
  await expect(results.getByText('Contatados', { exact: true }).locator('..')).toContainText('2');
  await expect(results.getByText('Responderam', { exact: true }).locator('..')).toContainText('1');
  await expect(results.getByText('Recompraram (observado)', { exact: true }).locator('..')).toContainText('1');
  await expect(results.getByText('Valor observado', { exact: true }).locator('..')).toContainText(/R\$\s?550,00/);
  await expect(page.getByText('Não afirmam que a campanha causou a compra').first()).toBeVisible();
  await expect(page.getByText(/incremental/i)).toHaveCount(0);
  await expect(page.getByRole('listitem').filter({ hasText: `Ana Ativa ${s}` })).toContainText('Recomprou (observado)');

  await page.getByRole('button', { name: 'Concluir' }).click();
  await expect(page.getByText('Concluída', { exact: true }).first()).toBeVisible();
  await page.goto('/campanhas');
  await expect(page.getByRole('row', { name: new RegExp(`Retomada ${s}`) })).toContainText('Concluída');
  expect(violations).toEqual([]);
  await owner.ctx.close();
});

test('permissão em lote exige base legal, não sobrescreve escolhas e não vence a supressão', async ({ browser }) => {
  const owner = await setupOwner(browser, 'lote');
  const { page } = owner;
  const s = suffix();
  const a = await createCustomerApi(owner, `Lote A ${s}`, { email: `a.${s}@exemplo.test`, phone: '5511912345678' });
  const b = await createCustomerApi(owner, `Lote B ${s}`, { email: `b.${s}@exemplo.test`, phone: '5511912345679' });
  const c = await createCustomerApi(owner, `Lote C ${s}`, { email: `c.${s}@exemplo.test`, phone: '5511912345670' });
  await rpc(owner.token, 'pv_set_preference', { p_customer: b, p_channel: 'whatsapp', p_status: 'denied', p_basis: null });
  await rpc(owner.token, 'pv_suppress', { p_customer: c, p_channel: null, p_reason: 'Pediu descadastro' });

  await page.goto('/campanhas');
  await page.getByLabel('Base legal / referência').fill('');
  await page.getByRole('button', { name: 'Aplicar aos clientes sem preferência' }).click();
  await expect(page.getByText('Informe a base legal ou a referência do consentimento.')).toBeVisible();
  await page.getByLabel('Base legal / referência').fill('Contrato de fornecimento vigente');
  await page.getByRole('button', { name: 'Aplicar aos clientes sem preferência' }).click();
  await expect(page.getByText(/cliente\(s\) sem preferência registrada receberam esta permissão/)).toBeVisible();
  const prefs = await rest(owner.token, 'communication_preferences?select=customer_id,permission_status,legal_basis_reference&order=customer_id');
  const rows = (await prefs.json()) as Array<{ customer_id: string; permission_status: string }>;
  const byId = new Map(rows.map((r) => [r.customer_id, r.permission_status]));
  expect(byId.get(a)).toBe('legitimate_interest');
  expect(byId.get(b)).toBe('denied'); // escolha do cliente preservada
  expect(byId.get(c)).toBe('legitimate_interest'); // ganhou permissão, mas segue bloqueado pela supressão
  await owner.ctx.close();
});
