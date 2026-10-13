import { test } from '@playwright/test';
import { uiLogin } from './helpers';
import { DEMO_PASSWORD } from './pv-helpers';

// Capturas para revisão visual (dados de demonstração). Saída: test-results/screens/ (não roda no CI: grep-invert "capturas")
const VIEWS = [
  { name: 'desktop', viewport: { width: 1280, height: 800 }, colorScheme: 'light' as const },
  { name: 'mobile', viewport: { width: 390, height: 844 }, colorScheme: 'light' as const },
  { name: 'dark', viewport: { width: 1280, height: 800 }, colorScheme: 'dark' as const },
];

for (const v of VIEWS) {
  test(`capturas ${v.name}`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: v.viewport, colorScheme: v.colorScheme });
    const page = await ctx.newPage();
    const shot = async (n: string) => {
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(1200);
      await page.screenshot({ path: `test-results/screens/${v.name}-${n}.png`, fullPage: true });
    };
    await uiLogin(page, 'gerente@demo.exemplo', DEMO_PASSWORD);
    await page.waitForURL('**/dashboard');
    for (const [n, path] of [
      ['dashboard', '/dashboard?period=90d'], ['clientes', '/clientes'], ['compras', '/compras'], ['segmentacao', '/segmentacao'], ['reativacao', '/reativacao'], ['campanhas', '/campanhas'],
      ['modelos', '/campanhas/modelos'], ['atividades', '/atividades'], ['relatorios', '/relatorios?period=90d'], ['notificacoes', '/notificacoes'],
      ['importar-clientes', '/clientes/importar'], ['importar-compras', '/compras/importar'], ['segmento-novo', '/segmentacao/segmentos/novo'], ['cliente-novo', '/clientes/novo'],
    ] as const) {
      await page.goto(path);
      await shot(n);
    }
    await page.goto('/clientes?state=at_risk');
    await page.getByRole('table', { name: 'Clientes' }).getByRole('link').first().click();
    await shot('cliente-ficha');
    await page.goto('/reativacao');
    await page.getByRole('link', { name: 'Ver explicação' }).first().click();
    await shot('oportunidade');
    await page.goto('/campanhas');
    await page.getByRole('link', { name: /Volta por cima/ }).click();
    await shot('campanha');
    await ctx.close();
  });
}
