import type { Browser, BrowserContext, Page } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { apiAal2Token, apiLogin, apiSignUp, onboardAndEnrollMfa, rest, uiLogin, uniqueEmail } from './helpers';

export type Owner = { ctx: BrowserContext; page: Page; email: string; userId: string; secret: string; orgId: string; token: string };

export const suffix = () => randomBytes(3).toString('hex');
export const DEMO_PASSWORD = 'DemoLocal#2026';
export const DEMO_ORG = 'c5c5c5c5-0000-4000-8000-000000000001';

/** Cria um proprietário com organização e MFA ativo, mais um token AAL2 para preparar dados via API. */
export async function setupOwner(browser: Browser, tag: string): Promise<Owner> {
  const email = uniqueEmail(tag);
  const { id: userId } = await apiSignUp(email);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on('dialog', (d) => void d.accept());
  await uiLogin(page, email);
  const secret = await onboardAndEnrollMfa(page, `Empresa ${tag} ${suffix()}`);
  const orgId = (await ctx.cookies()).find((c) => c.name === 'pack25_org')!.value;
  const token = await apiAal2Token(await apiLogin(email), secret);
  return { ctx, page, email, userId, secret, orgId, token };
}

export async function restJson<T = unknown>(token: string, path: string, init?: RequestInit): Promise<T> {
  const res = await rest(token, path, init);
  if (!res.ok) throw new Error(`REST ${path} falhou: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

export async function rpc<T = unknown>(token: string, fn: string, args: Record<string, unknown>): Promise<T> {
  const res = await rest(token, `rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) });
  if (!res.ok) throw new Error(`rpc ${fn} falhou: ${res.status} ${await res.text()}`);
  const body = await res.text();
  return (body ? JSON.parse(body) : null) as T;
}

/** Registra violações de Content-Security-Policy vistas no console do navegador. */
export function watchCsp(page: Page): string[] {
  const violations: string[] = [];
  page.on('console', (m) => {
    if (/content security policy|refused to (execute|load|apply)/i.test(m.text())) violations.push(m.text());
  });
  return violations;
}

export async function addMember(owner: Owner, userId: string, role: 'member' | 'manager' | 'viewer') {
  await restJson(owner.token, 'organization_members', { method: 'POST', body: JSON.stringify({ organization_id: owner.orgId, user_id: userId, role }) });
}

/** Data (YYYY-MM-DD) daqui a `days` dias, no horário de Brasília. */
export function inDays(days: number): string {
  const d = new Date(Date.now() + days * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d);
}
/** Data DD/MM/AAAA daqui a `days` dias (formato dos arquivos CSV brasileiros). */
export function brDate(days: number): string {
  return inDays(days).split('-').reverse().join('/');
}

/** Cria um cliente por API (para preparar cenários que não são sobre o cadastro). */
export async function createCustomerApi(owner: Owner, name: string, extra: Record<string, unknown> = {}): Promise<string> {
  const rows = await restJson<Array<{ id: string }>>(owner.token, 'customers', { method: 'POST', body: JSON.stringify({ organization_id: owner.orgId, name, ...extra }) });
  return rows[0]!.id;
}

/** Registra uma compra por API, `daysAgo` dias atrás (ao meio-dia de Brasília). */
export async function createPurchaseApi(owner: Owner, customerId: string, daysAgo: number, cents: number, order?: string) {
  const at = new Date(`${inDays(-daysAgo)}T15:00:00Z`).toISOString();
  const r = await rpc<{ ok: boolean; id?: string; error?: string }>(owner.token, 'pv_purchase_create', { p_customer: customerId, p_external: order ?? null, p_at: at, p_total_cents: cents, p_items: [], p_source: 'teste', p_notes: null, p_allow_duplicate: true });
  if (!r.ok) throw new Error(`compra de teste falhou: ${r.error}`);
  return r.id!;
}

/** Compra datada do dia SEGUINTE (00:01 em Brasília): é sempre aceita pela função (até agora + 24 h) e cai em um dia posterior ao de hoje. */
export async function createPurchaseTomorrowApi(owner: Owner, customerId: string, cents: number) {
  const at = new Date(`${inDays(1)}T03:01:00Z`).toISOString();
  const r = await rpc<{ ok: boolean; id?: string; error?: string }>(owner.token, 'pv_purchase_create', { p_customer: customerId, p_external: null, p_at: at, p_total_cents: cents, p_items: [], p_source: 'teste', p_notes: null, p_allow_duplicate: true });
  if (!r.ok) throw new Error(`compra de teste falhou: ${r.error}`);
  return r.id!;
}

export function csvBuffer(lines: string[]): Buffer {
  return Buffer.from(`﻿${lines.join('\r\n')}\r\n`, 'utf8');
}
