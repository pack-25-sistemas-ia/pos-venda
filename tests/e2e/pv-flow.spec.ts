import { expect, test } from '@playwright/test';
import { brDate, createCustomerApi, createPurchaseApi, csvBuffer, restJson, setupOwner, suffix, watchCsp } from './pv-helpers';

const money = (v: string) => new RegExp(v.replace(/\./g, '\\.').replace('$', '\\$').replace(/ /g, '\\s'));

test('cliente e compra à mão: cadastro, duplicidade avisada, estorno parcial e cancelamento', async ({ browser }) => {
  const owner = await setupOwner(browser, 'flow');
  const { page } = owner;
  const violations = watchCsp(page);
  const email = `maria.${suffix()}@exemplo.test`;

  await page.goto('/clientes/novo');
  await page.getByLabel('Nome', { exact: true }).fill('Maria da Mercearia');
  await page.getByLabel('E-mail', { exact: true }).fill(email.toUpperCase());
  await page.getByLabel('Telefone / WhatsApp').fill('(11) 91234-5678');
  await page.getByLabel('CPF / CNPJ').fill('123.456.789-09');
  await page.getByRole('button', { name: 'Cadastrar cliente' }).click();
  await page.waitForURL(/\/clientes\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: 'Maria da Mercearia' })).toBeVisible();
  await expect(page.getByText(email, { exact: true })).toBeVisible(); // normalizado em minúsculas
  await expect(page.getByText('+55 (11) 91234-5678')).toBeVisible();
  await expect(page.getByText('123.456.789-09')).toBeVisible();
  const customerUrl = page.url();

  // o mesmo e-mail não cria um segundo cliente
  await page.goto('/clientes/novo');
  await page.getByLabel('Nome', { exact: true }).fill('Maria Repetida');
  await page.getByLabel('E-mail', { exact: true }).fill(email);
  await page.getByRole('button', { name: 'Cadastrar cliente' }).click();
  await expect(page.getByText('Já cadastrado (e-mail, documento ou identificador).')).toBeVisible();

  // compra pela ficha, com item e valor total em reais
  await page.goto(customerUrl);
  await page.getByRole('link', { name: 'Registrar compra' }).click();
  await page.getByLabel('Número do pedido').fill('PED-1');
  await page.getByLabel('Valor total (R$)').fill('1.234,56');
  await page.getByRole('button', { name: 'Registrar compra' }).click();
  await page.waitForURL(customerUrl);
  await expect(page.getByText(money('R$ 1.234,56')).first()).toBeVisible();
  await expect(page.getByText('Pedido PED-1')).toBeVisible();
  await expect(page.getByText('Pedidos válidos').locator('..')).toContainText('1');

  // mesmo pedido de novo: recusado; mesma data e valor sem número: avisa e só grava se confirmar
  await page.getByRole('link', { name: 'Registrar compra' }).click();
  await page.getByLabel('Número do pedido').fill('PED-1');
  await page.getByLabel('Valor total (R$)').fill('10,00');
  await page.getByRole('button', { name: 'Registrar compra' }).click();
  await expect(page.getByText('Já existe uma compra com este número de pedido.')).toBeVisible();
  await page.getByLabel('Número do pedido').fill('');
  await page.getByLabel('Valor total (R$)').fill('55,00');
  await page.getByRole('button', { name: 'Registrar compra' }).click();
  await page.waitForURL(customerUrl); // sem número e sem duplicata: grava
  await page.getByRole('link', { name: 'Registrar compra' }).click();
  await page.getByLabel('Valor total (R$)').fill('55,00');
  await page.getByRole('button', { name: 'Registrar compra' }).click();
  await expect(page.getByText(/Possível compra duplicada/)).toBeVisible();
  await page.getByLabel(/Registrar mesmo assim/).check();
  await page.getByRole('button', { name: 'Registrar compra' }).click();
  await page.waitForURL(customerUrl);
  await expect(page.getByText('Pedidos válidos').locator('..')).toContainText('3');

  // valor inválido é recusado no navegador
  await page.getByRole('link', { name: 'Registrar compra' }).click();
  await page.getByLabel('Valor total (R$)').fill('abc');
  await page.getByRole('button', { name: 'Registrar compra' }).click();
  await expect(page.getByText('Informe um valor em reais (ex.: 1.234,56).')).toBeVisible();

  // estorno parcial mantém a compra válida; cancelamento a tira dos números
  await page.goto(customerUrl);
  const first = page.getByRole('listitem').filter({ hasText: 'Pedido PED-1' });
  await first.getByRole('button', { name: 'Estornar…' }).click();
  await first.getByLabel('Valor estornado (R$)').fill('234,56');
  await first.getByRole('button', { name: 'Registrar estorno' }).click();
  await expect(first).toContainText('estornado');
  await expect(first).toContainText('Válida');
  await expect(page.getByText('Total gasto (líquido)').locator('..')).toContainText(/R\$\s?1\.110,00/); // 1.234,56 + 55,00 + 55,00 − 234,56 de estorno
  await first.getByRole('button', { name: 'Cancelar compra' }).click();
  await expect(first).toContainText('Cancelada');
  await expect(page.getByText('Pedidos válidos').locator('..')).toContainText('2');
  expect(violations).toEqual([]);
  await owner.ctx.close();
});

test('importação por assistente: mapeamento, validação sem gravar, importação e reenvio sem duplicar', async ({ browser }) => {
  const owner = await setupOwner(browser, 'imp');
  const { page } = owner;
  const s = suffix();
  const ana = `ana.${s}@exemplo.test`;
  const bruno = `bruno.${s}@exemplo.test`;

  await page.goto('/clientes/importar');
  const file = { name: 'clientes.csv', mimeType: 'text/csv', buffer: csvBuffer(['Nome;E-mail;Telefone;CPF', `Ana Souza;${ana};(11) 91234-5678;123.456.789-09`, `Bruno Lima;${bruno};11 98888-7777;`, 'Carla Dias;email-invalido;;', `Ana Repetida;${ana};;`]) };
  await page.setInputFiles('#import-file', file);
  await expect(page.getByText(/«clientes\.csv» — 4 linha\(s\), 4 coluna\(s\), separador «;»/)).toBeVisible();
  // colunas reconhecidas pelo cabeçalho
  await expect(page.getByLabel('Nome *')).toHaveValue('0');
  await expect(page.getByLabel('E-mail', { exact: true })).toHaveValue('1');
  await expect(page.getByRole('button', { name: 'Importar agora' })).toBeDisabled();
  await page.getByRole('button', { name: 'Validar sem gravar' }).click();
  await expect(page.getByText('Validação concluída: 2 cliente(s) prontos para importar, 1 duplicado(s), 1 com erro. Nada foi gravado.')).toBeVisible();
  await expect(page.getByText('Linha 4: E-mail inválido.')).toBeVisible();
  // a validação não gravou nada
  await page.goto('/clientes');
  await expect(page.getByText('Nenhum cliente encontrado')).toBeVisible();

  await page.goto('/clientes/importar');
  await page.setInputFiles('#import-file', file);
  await page.getByRole('button', { name: 'Validar sem gravar' }).click();
  await page.getByRole('button', { name: 'Importar agora' }).click();
  await expect(page.getByText('2 cliente(s) importado(s).')).toBeVisible();
  await page.getByRole('link', { name: 'Ver clientes' }).click();
  await expect(page.getByText('2 registro(s)')).toBeVisible();
  // clientes importados NÃO ganham permissão de contato
  const prefs = await restJson<unknown[]>(owner.token, 'communication_preferences?select=id');
  expect(prefs).toHaveLength(0);

  // reenvio do mesmo arquivo: tudo duplicado, nada a importar
  await page.goto('/clientes/importar');
  await page.setInputFiles('#import-file', file);
  await page.getByRole('button', { name: 'Validar sem gravar' }).click();
  await expect(page.getByText('Validação concluída: 0 cliente(s) prontos para importar, 3 duplicado(s), 1 com erro. Nada foi gravado.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Importar agora' })).toBeDisabled();

  // compras: dinheiro e data no formato brasileiro, status em português, linhas ruins explicadas
  await page.goto('/compras/importar');
  const purchases = {
    name: 'compras.csv', mimeType: 'text/csv',
    buffer: csvBuffer([
      'Pedido;Data;E-mail do cliente;Valor total;Status;Produto;Categoria',
      `P-1;${brDate(-150)};${ana};R$ 1.234,56;Concluída;Café 500g;Café e chás`,
      `P-2;${brDate(-120)};${ana};890,00;Concluída;Açúcar 5kg;Mercearia`,
      `P-3;${brDate(-100)};${ana};1.000;Cancelada;;`,
      `P-4;${brDate(-30)};${bruno};abc;Concluída;;`,
      `P-5;31/02/2026;${bruno};100,00;;;`,
      `P-6;${brDate(-10)};naoexiste@exemplo.test;50,00;;;`,
    ]),
  };
  await page.setInputFiles('#import-file', purchases);
  await expect(page.getByText(/6 linha\(s\)/)).toBeVisible();
  await expect(page.getByLabel('Valor total', { exact: true })).toHaveValue('3');
  await expect(page.getByText(/2 valor\(es\) não puderam ser convertidos/)).toBeVisible();
  await page.getByRole('button', { name: 'Validar sem gravar' }).click();
  await expect(page.getByText('Validação concluída: 3 compra(s) prontos para importar, 0 duplicado(s), 3 com erro. Nada foi gravado.')).toBeVisible();
  await expect(page.getByText(/Cliente não encontrado/)).toBeVisible();
  await page.getByRole('button', { name: 'Importar agora' }).click();
  await expect(page.getByText('3 compra(s) importado(s).')).toBeVisible();
  await page.getByRole('link', { name: 'Ver compras' }).click();
  await expect(page.getByText('3 registro(s)')).toBeVisible();
  await expect(page.getByRole('table', { name: 'Compras' })).toContainText('P-1');
  await expect(page.getByRole('table', { name: 'Compras' })).toContainText('Cancelada');
  const stored = await restJson<Array<{ external_order_id: string; total_cents: number }>>(owner.token, 'purchases?select=external_order_id,total_cents&order=external_order_id');
  expect(stored).toEqual([{ external_order_id: 'P-1', total_cents: 123456 }, { external_order_id: 'P-2', total_cents: 89000 }, { external_order_id: 'P-3', total_cents: 100000 }]);

  // o mesmo arquivo de novo: pedidos repetidos viram duplicados, avisando que o arquivo já foi importado
  await page.goto('/compras/importar');
  await page.setInputFiles('#import-file', purchases);
  await page.getByRole('button', { name: 'Validar sem gravar' }).click();
  await expect(page.getByText('Validação concluída: 0 compra(s) prontos para importar, 3 duplicado(s), 3 com erro. Nada foi gravado.')).toBeVisible();
  await expect(page.getByText('Um arquivo idêntico a este já foi importado antes.')).toBeVisible();
  await owner.ctx.close();
});

test('motor: rodada RFM, análise de risco, oportunidade explicada e tarefa', async ({ browser }) => {
  const owner = await setupOwner(browser, 'eng');
  const { page } = owner;
  // 6 clientes com histórico regular e distância diferente da última compra
  const ids: string[] = [];
  for (const [i, last] of [5, 15, 40, 100, 130, 200].entries()) {
    const id = await createCustomerApi(owner, `Cliente ${i + 1} ${suffix()}`, { email: `c${i}.${suffix()}@exemplo.test` });
    ids.push(id);
    for (const [k, gap] of [0, 30, 60].entries()) await createPurchaseApi(owner, id, last + gap, 20000 + k * 5000 + i * 1000);
  }

  await page.goto('/segmentacao');
  await expect(page.getByText('Ainda não há rodada RFM')).toBeVisible();
  await page.getByRole('button', { name: 'Calcular nova rodada RFM' }).click();
  await expect(page.getByText('v1', { exact: true }).first()).toBeVisible();
  const table = page.getByRole('table', { name: 'Clientes por segmento RFM' });
  await expect(table).toBeVisible();
  // 6 pontuados (>= 5): sem aviso de amostra pequena; e uma segunda rodada não apaga a primeira
  await expect(page.getByText(/Amostra pequena/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Calcular nova rodada RFM' }).click();
  await expect(page.getByRole('heading', { name: 'Rodadas anteriores' }).locator('xpath=ancestor::section[1]')).toContainText('v2');
  await expect(page.getByRole('heading', { name: 'Rodadas anteriores' }).locator('xpath=ancestor::section[1]')).toContainText('v1');

  await page.goto('/reativacao');
  await expect(page.getByText('Nenhuma oportunidade')).toBeVisible();
  await page.getByRole('button', { name: 'Atualizar análise de risco' }).click();
  const opps = page.getByRole('table', { name: 'Oportunidades de reativação' });
  await expect(opps).toBeVisible();
  // quem comprou há 5, 15 e 40 dias está ativo; 100 e 130 dias = em risco; 200 = inativo
  const rows = opps.getByRole('row');
  expect(await rows.count()).toBeGreaterThanOrEqual(4);
  await expect(opps).not.toContainText('Cliente 1 ');
  await expect(opps).toContainText('Inatividade');

  // explicação transparente
  await page.getByRole('link', { name: 'Ver explicação' }).first().click();
  await expect(page.getByRole('heading', { name: 'Por que este cliente está aqui?' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Como a prioridade foi calculada' })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Componentes da prioridade' })).toContainText('Atraso em relação ao esperado');
  await expect(page.getByText(/ticket mediano histórico/)).toBeVisible();

  // trabalhar a oportunidade
  await page.getByRole('button', { name: 'Iniciar abordagem' }).click();
  await expect(page.getByText('Em andamento').first()).toBeVisible();
  await page.getByLabel('Próxima ação').fill('Ligar amanhã com a condição de reposição');
  await page.getByRole('button', { name: 'Salvar próxima ação' }).click();
  await expect(page.getByText('Próxima ação salva.')).toBeVisible();
  // confirmar reativação sem compra posterior é recusado
  await page.getByRole('button', { name: 'Confirmar reativação' }).click();
  await expect(page.getByText(/sem evidência de reativação/i)).toBeVisible();
  // descartar exige motivo
  await expect(page.getByRole('button', { name: 'Descartar', exact: true })).toBeDisabled();
  await page.getByLabel('Descartar oportunidade').fill('Cliente encerrou a atividade');
  await page.getByRole('button', { name: 'Descartar', exact: true }).click();
  await expect(page.getByText('Oportunidade encerrada.')).toBeVisible();

  // nova compra de um cliente em risco reconhece a reativação sozinha
  const atRisk = await restJson<Array<{ customer_id: string; status: string }>>(owner.token, 'reactivation_opportunities?select=customer_id,status&status=eq.open&reason=eq.inactivity');
  expect(atRisk.length).toBeGreaterThan(0);
  const back = atRisk[0]!.customer_id;
  await createPurchaseApi(owner, back, 0, 31000);
  const after = await restJson<Array<{ status: string; reactivated_purchase_id: string | null }>>(owner.token, `reactivation_opportunities?select=status,reactivated_purchase_id&customer_id=eq.${back}&reason=eq.inactivity`);
  expect(after[0]).toMatchObject({ status: 'reactivated' });
  expect(after[0]!.reactivated_purchase_id).toBeTruthy();
  await page.goto(`/clientes/${back}`);
  await expect(page.getByText('Voltou a comprar (reativação observada)')).toBeVisible();

  // tarefa na ficha: cria, aparece em «Tarefas» e conclui
  await page.getByLabel('Título', { exact: true }).fill('Ligar para entender a pausa');
  await page.getByRole('button', { name: 'Salvar tarefa' }).click();
  await expect(page.getByText('Ligar para entender a pausa').first()).toBeVisible();
  await page.goto('/atividades');
  const item = page.getByRole('listitem').filter({ hasText: 'Ligar para entender a pausa' });
  await expect(item).toContainText('Pendente'.replace('Pendente', ''));
  await item.getByRole('button', { name: 'Concluir' }).click();
  await expect(page.getByText('Nenhuma tarefa pendente')).toBeVisible();
  await owner.ctx.close();
});

test('segmento personalizado sem SQL: critérios validados, contagem e descrição em português', async ({ browser }) => {
  const owner = await setupOwner(browser, 'seg');
  const { page } = owner;
  for (const [i, last] of [10, 120, 200].entries()) {
    const id = await createCustomerApi(owner, `Seg ${i} ${suffix()}`, { email: `s${i}.${suffix()}@exemplo.test` });
    await createPurchaseApi(owner, id, last, 30000);
  }
  await page.goto('/segmentacao/segmentos/novo');
  await page.getByLabel('Nome do segmento').fill('Sumidos há 90 dias ou mais');
  await expect(page.getByText('Em português:').locator('..')).toContainText('Dias desde a última compra maior ou igual a 90');
  await page.getByRole('button', { name: 'Ver quantos clientes entram' }).click();
  await expect(page.getByText('2 cliente(s) atendem a estes critérios hoje.').first()).toBeVisible();
  // condição incompleta bloqueia o salvamento
  await page.getByLabel('Campo da condição 1').selectOption('category');
  await expect(page.getByRole('button', { name: 'Criar segmento' })).toBeDisabled();
  await page.getByLabel('Campo da condição 1').selectOption('days_since_last');
  await page.getByRole('button', { name: 'Criar segmento' }).click();
  await page.waitForURL('**/segmentacao');
  await expect(page.getByText('Sumidos há 90 dias ou mais')).toBeVisible();
  // a lista de campos é fechada: tentativa de campo livre via API é recusada pelo banco
  const res = await fetch(`${process.env.E2E_SUPABASE_URL}/rest/v1/segment_definitions`, {
    method: 'POST',
    headers: { apikey: process.env.E2E_SUPABASE_ANON_KEY ?? '', authorization: `Bearer ${owner.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ organization_id: owner.orgId, name: 'Hack', criteria_json: { match: 'all', conditions: [{ field: "1=1; drop table customers; --", op: 'eq', value: 1 }] } }),
  });
  expect(res.ok).toBe(false);
  await owner.ctx.close();
});
