import { expect, test, type Page } from '@playwright/test';
import { uiLogin } from './helpers';
import { DEMO_PASSWORD } from './pv-helpers';

// Telas em celular (390×844): a PÁGINA não pode rolar para o lado (tabelas largas rolam dentro do próprio contêiner).
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

const noHorizontalScroll = async (page: Page, where: string) => {
  const w = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
  expect(w.scroll, `${where}: a página rola para o lado (${w.scroll} > ${w.inner})`).toBeLessThanOrEqual(w.inner + 1);
};

test('páginas autenticadas cabem na tela do celular e o menu funciona', async ({ page }) => {
  await uiLogin(page, 'gerente@demo.exemplo', DEMO_PASSWORD);
  await page.waitForURL('**/dashboard');
  await expect(page.getByText('Menu', { exact: true })).toBeVisible();
  for (const path of [
    '/dashboard?period=90d', '/clientes', '/clientes/novo', '/clientes/importar', '/compras', '/compras/nova', '/compras/importar', '/segmentacao', '/segmentacao/segmentos/novo', '/reativacao',
    '/campanhas', '/campanhas/nova', '/campanhas/modelos', '/atividades', '/relatorios?period=90d', '/notificacoes',
  ]) {
    await page.goto(path);
    await page.waitForLoadState('load');
    await page.waitForTimeout(500);
    await noHorizontalScroll(page, path);
  }
  // menu abre e navega
  await page.goto('/dashboard');
  await page.getByText('Menu', { exact: true }).click();
  await page.getByRole('navigation', { name: 'Principal' }).last().getByRole('link', { name: 'Clientes' }).click();
  await page.waitForURL('**/clientes');
  // ficha do cliente, oportunidade e campanha no celular
  await page.getByRole('table', { name: 'Clientes' }).getByRole('link').first().click();
  await page.waitForURL(/\/clientes\/[0-9a-f-]{36}$/);
  await noHorizontalScroll(page, 'ficha do cliente');
  await page.goto('/reativacao');
  await page.getByRole('link', { name: 'Ver explicação' }).first().click();
  await page.waitForURL(/\/reativacao\/[0-9a-f-]{36}$/);
  await noHorizontalScroll(page, 'oportunidade');
  await page.goto('/campanhas');
  await page.getByRole('link', { name: /Volta por cima/ }).click();
  await page.waitForURL(/\/campanhas\/[0-9a-f-]{36}$/);
  await noHorizontalScroll(page, 'campanha');
});

test('alvos de toque e formulários utilizáveis no celular', async ({ page }) => {
  await uiLogin(page, 'gerente@demo.exemplo', DEMO_PASSWORD);
  await page.waitForURL('**/dashboard');
  await page.goto('/clientes/novo');
  for (const label of ['Nome', 'E-mail', 'Telefone / WhatsApp']) {
    const b = await page.getByLabel(label, { exact: true }).first().boundingBox();
    expect(b!.height, label).toBeGreaterThanOrEqual(40);
  }
  const submit = await page.getByRole('button', { name: 'Cadastrar cliente' }).boundingBox();
  expect(submit!.height).toBeGreaterThanOrEqual(40);
  await page.goto('/dashboard?period=90d');
  const apply = await page.getByRole('button', { name: 'Aplicar' }).boundingBox();
  expect(apply!.height).toBeGreaterThanOrEqual(40);
  await noHorizontalScroll(page, 'painel');
});
