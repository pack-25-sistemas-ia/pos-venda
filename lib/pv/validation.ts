// Validação dos formulários do sistema (cliente e servidor usam o MESMO esquema). A saída já vem normalizada para gravar.
import { z } from 'zod';
import { ACTIVITY_TYPES, isRealDate, safeTimezone } from './filters';
import { parseMoneyToCents } from './import';
import { validateCriteria } from './segments';
import { MAX_TEMPLATE_LENGTH, validateTemplate } from './templates';

export const text = (min: number, max: number) =>
  z.string().trim().min(min, min <= 1 ? 'Campo obrigatório.' : `Informe ao menos ${min} caracteres.`).max(max, `Máximo de ${max} caracteres.`);
export const optionalText = (max: number) =>
  z.string().trim().max(max, `Máximo de ${max} caracteres.`).transform((v) => (v === '' ? null : v));
export const optionalUuid = z.union([z.literal(''), z.uuid('Seleção inválida.')]).transform((v) => (v === '' ? null : v));

/** Normalização idêntica à do banco (private.pv_norm_*). */
export const normEmail = (v: string): string | null => {
  const s = v.trim().toLowerCase();
  return s === '' ? null : s;
};
export function normPhone(v: string): string | null {
  let d = v.replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  return d.length >= 8 && d.length <= 15 ? d : null;
}
export const normDocument = (v: string): string | null => {
  const d = v.replace(/\D/g, '');
  return d === '' ? null : d;
};

const emailField = z.string().trim().toLowerCase().max(254, 'E-mail muito longo.').refine((v) => v === '' || z.email().safeParse(v).success, 'E-mail inválido.');
const phoneField = z.string().trim().max(30, 'Telefone muito longo.').refine((v) => v === '' || (/^[0-9+()\-.\s]{8,30}$/.test(v) && normPhone(v) !== null), 'Telefone inválido (use DDD).');
const documentField = z.string().trim().max(24, 'Documento muito longo.').refine((v) => {
  const d = v.replace(/\D/g, '');
  return d === '' || d.length === 11 || d.length === 14;
}, 'CPF deve ter 11 e CNPJ 14 dígitos.');

const intInRange = (min: number, max: number, label: string) =>
  z.string().trim().regex(/^-?\d+$/, `${label}: informe um número inteiro.`).transform(Number).refine((n) => n >= min && n <= max, `${label}: de ${min} a ${max}.`);

// ---------------------------------------------------------------- clientes
export const customerSchema = z.object({
  name: text(1, 160),
  customer_type: z.enum(['person', 'company'], 'Tipo inválido.'),
  email: emailField,
  phone: phoneField,
  document_number: documentField,
  company_name: optionalText(160),
  external_customer_id: optionalText(80),
  notes: optionalText(4000),
});
export type CustomerInput = z.input<typeof customerSchema>;

export function customerRecord(v: z.output<typeof customerSchema>) {
  return {
    name: v.name, customer_type: v.customer_type, email: normEmail(v.email), phone: v.phone === '' ? null : normPhone(v.phone), document_number: normDocument(v.document_number),
    company_name: v.company_name, external_customer_id: v.external_customer_id, notes: v.notes,
  };
}

// ---------------------------------------------------------------- compras
const moneyField = z.string().trim().refine((v) => parseMoneyToCents(v) !== null, 'Informe um valor em reais (ex.: 1.234,56).');
export const purchaseItemSchema = z.object({
  product_name: text(1, 200),
  category: optionalText(80),
  quantity: z.string().trim().regex(/^\d+([.,]\d{1,3})?$/, 'Quantidade inválida.').transform((v) => Number(v.replace(',', '.'))).refine((n) => n > 0 && n <= 1_000_000, 'Quantidade inválida.'),
  unit_price: moneyField,
});
export const purchaseSchema = z.object({
  customer_id: z.uuid('Escolha o cliente.'),
  date: z.string().trim().refine((v) => isRealDate(v), 'Informe uma data válida.'),
  external_order_id: optionalText(80),
  total: z.string().trim(),
  source: optionalText(80),
  notes: optionalText(1000),
  allow_duplicate: z.boolean(),
  items: z.array(purchaseItemSchema).max(30, 'No máximo 30 itens.'),
}).superRefine((v, ctx) => {
  if (v.total === '' && v.items.length === 0) ctx.addIssue({ code: 'custom', path: ['total'], message: 'Informe o valor da compra ou os itens.' });
  if (v.total !== '' && parseMoneyToCents(v.total) === null) ctx.addIssue({ code: 'custom', path: ['total'], message: 'Informe um valor em reais (ex.: 1.234,56).' });
});
export type PurchaseInput = z.input<typeof purchaseSchema>;

export const refundSchema = z.object({ amount: moneyField });

// ---------------------------------------------------------------- tarefas
export const activitySchema = z.object({
  type: z.enum(ACTIVITY_TYPES, 'Tipo inválido.'),
  title: text(1, 160),
  description: optionalText(2000),
  priority: z.enum(['low', 'normal', 'high'], 'Prioridade inválida.'),
  assigned_to: optionalUuid,
  due_at: z.string().trim().refine((v) => v === '' || !Number.isNaN(Date.parse(v)), 'Data inválida.').transform((v) => (v === '' ? null : new Date(v).toISOString())),
  campaign_id: optionalUuid,
  opportunity_id: optionalUuid,
  done: z.boolean(),
});

// ---------------------------------------------------------------- preferências e supressão
export const preferenceSchema = z.object({
  channel: z.enum(['phone', 'whatsapp', 'email'], 'Canal inválido.'),
  status: z.enum(['granted', 'legitimate_interest', 'denied'], 'Escolha a permissão.'),
  basis: z.string().trim().max(300, 'Máximo de 300 caracteres.'),
}).refine((v) => v.status === 'denied' || v.basis !== '', { path: ['basis'], message: 'Informe a base legal ou a referência do consentimento.' });
export const suppressionSchema = z.object({
  channel: z.union([z.literal(''), z.enum(['phone', 'whatsapp', 'email'])]).transform((v) => (v === '' ? null : v)),
  reason: text(1, 300),
});

// ---------------------------------------------------------------- segmentos, campanhas, modelos
export const segmentSchema = z.object({
  name: text(2, 120),
  description: optionalText(600),
  criteria: z.object({ match: z.enum(['all', 'any']), conditions: z.array(z.object({ field: z.string().max(40), op: z.string().max(20), value: z.unknown().optional() })).max(10) })
    .superRefine((c, ctx) => { for (const m of validateCriteria(c)) ctx.addIssue({ code: 'custom', message: m }); }),
});

export const campaignSchema = z.object({
  name: text(2, 120),
  description: optionalText(1000),
  objective: optionalText(300),
  channel: z.enum(['phone', 'whatsapp', 'email'], 'Canal inválido.'),
  segment_id: optionalUuid,
  owner_id: optionalUuid,
  message_subject: optionalText(200),
  message_body: z.string().trim().max(MAX_TEMPLATE_LENGTH, `Máximo de ${MAX_TEMPLATE_LENGTH} caracteres.`).superRefine((v, ctx) => { for (const m of validateTemplate(v)) ctx.addIssue({ code: 'custom', message: m }); }).transform((v) => (v === '' ? null : v)),
  observation_days: intInRange(7, 365, 'Janela de observação'),
});
export const contactSchema = z.object({
  status: z.enum(['planned', 'contacted', 'responded', 'no_response', 'refused'], 'Status inválido.'),
  notes: optionalText(2000),
});
export const templateSchema = z.object({
  name: text(2, 120),
  channel: z.enum(['phone', 'whatsapp', 'email'], 'Canal inválido.'),
  subject: optionalText(200),
  body: text(1, MAX_TEMPLATE_LENGTH).superRefine((v, ctx) => { for (const m of validateTemplate(v)) ctx.addIssue({ code: 'custom', message: m }); }),
  active: z.boolean(),
});

// ---------------------------------------------------------------- oportunidades
export const oppActionSchema = z.object({ action: z.enum(['start', 'next_action', 'assign', 'discard', 'reactivated']), value: z.string().trim().max(300).optional() });

// ---------------------------------------------------------------- configurações
const limitList = z.string().trim().transform((s) => s.split(/[\s,;]+/).filter(Boolean).map((x) => Number(x.replace(',', '.'))))
  .refine((a) => a.length === 4 && a.every((n) => Number.isFinite(n) && n >= 0), 'Informe 4 números.')
  .refine((a) => a.every((n, i) => i === 0 || n > (a[i - 1] as number)), 'Os 4 números precisam ser crescentes.');

export const settingsSchema = z.object({
  timezone: z.string().trim().refine((v) => safeTimezone(v) === v, 'Fuso horário inválido.'),
  rfm_window_days: intInRange(30, 1095, 'Janela do RFM'),
  rfm_mode: z.enum(['percentile', 'fixed'], 'Modo inválido.'),
  limits_r: limitList, limits_f: limitList, limits_m: limitList,
  new_customer_days: intInRange(1, 365, 'Cliente novo'),
  risk_days: intInRange(7, 1095, 'Dias para risco'),
  inactive_days: intInRange(14, 1825, 'Dias para inatividade'),
  cycle_factor: z.string().trim().transform((v) => Number(v.replace(',', '.'))).refine((n) => Number.isFinite(n) && n >= 1.1 && n <= 10, 'Fator do ciclo: de 1,1 a 10.'),
  cycle_min_purchases: intInRange(3, 20, 'Compras mínimas do ciclo'),
  cycle_min_days: intInRange(1, 365, 'Dias mínimos do ciclo'),
  drop_window_days: intInRange(30, 365, 'Janela da queda'),
  drop_pct: intInRange(10, 100, 'Queda mínima (%)'),
  drop_min_prev: intInRange(2, 50, 'Pedidos mínimos no período anterior'),
  rule_inactivity: z.boolean(), rule_cycle: z.boolean(), rule_drop: z.boolean(), rule_segment_change: z.boolean(),
  observation_days: intInRange(7, 365, 'Janela de observação'),
  w_value: intInRange(0, 100, 'Peso do valor'), w_frequency: intInRange(0, 100, 'Peso da frequência'), w_overdue: intInRange(0, 100, 'Peso do atraso'),
  priority_high: intInRange(1, 100, 'Prioridade alta'), priority_medium: intInRange(1, 100, 'Prioridade média'),
  alert_overdue_tasks: z.boolean(),
}).superRefine((v, ctx) => {
  if (v.risk_days >= v.inactive_days) ctx.addIssue({ code: 'custom', path: ['inactive_days'], message: 'Precisa ser maior que os dias para risco.' });
  if (v.w_value + v.w_frequency + v.w_overdue <= 0) ctx.addIssue({ code: 'custom', path: ['w_value'], message: 'Ao menos um peso precisa ser maior que zero.' });
  if (v.priority_medium >= v.priority_high) ctx.addIssue({ code: 'custom', path: ['priority_medium'], message: 'A média precisa ser menor que a alta.' });
});

// ---------------------------------------------------------------- importação (corpo vindo do assistente no navegador)
export const importSchema = z.object({
  kind: z.enum(['customers', 'purchases']),
  fileName: z.string().trim().min(1).max(200),
  hash: z.string().regex(/^[0-9a-f]{64}$/).or(z.literal('')),
  apply: z.boolean(),
  createMissing: z.boolean().optional(),
  mapping: z.record(z.string().max(40), z.number().int().min(0).max(100).nullable()),
  rows: z.array(z.record(z.string().max(40), z.string().max(300))).min(1, 'O arquivo não tem linhas.').max(2000, 'Máximo de 2.000 linhas por importação.'),
});
