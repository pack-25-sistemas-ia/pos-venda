// Segmentos dinâmicos SEM SQL livre: lista fechada de campos e operadores. A validação de verdade é do banco
// (pv_validate_criteria + gatilho); este espelho dá retorno imediato ao construtor e descreve o critério em português.
import { CUSTOMER_STATES, SEGMENT_KEYS, STATE_LABELS } from './filters';
import { SEGMENT_LABELS, type SegmentKey } from './rfm';

export type Condition = { field: string; op: string; value?: unknown };
export type Criteria = { match: 'all' | 'any'; conditions: Condition[] };

export type FieldKind = 'number' | 'money' | 'date' | 'segments' | 'state' | 'category' | 'seller' | 'none' | 'channel';
export type FieldDef = { field: string; label: string; kind: FieldKind; ops: Array<{ op: string; label: string }> };

const NUM_OPS = [
  { op: 'gt', label: 'maior que' }, { op: 'gte', label: 'maior ou igual a' }, { op: 'lt', label: 'menor que' }, { op: 'lte', label: 'menor ou igual a' }, { op: 'eq', label: 'igual a' },
];
const DATE_OPS = [{ op: 'gt', label: 'depois de' }, { op: 'gte', label: 'a partir de' }, { op: 'lt', label: 'antes de' }, { op: 'lte', label: 'até' }];

export const SEGMENT_FIELDS: FieldDef[] = [
  { field: 'days_since_last', label: 'Dias desde a última compra', kind: 'number', ops: NUM_OPS },
  { field: 'purchases_count', label: 'Quantidade de compras', kind: 'number', ops: NUM_OPS },
  { field: 'total_spent_cents', label: 'Total gasto (R$)', kind: 'money', ops: NUM_OPS },
  { field: 'last_purchase_date', label: 'Data da última compra', kind: 'date', ops: DATE_OPS },
  { field: 'rfm_segment', label: 'Segmento RFM', kind: 'segments', ops: [{ op: 'in', label: 'é um de' }, { op: 'not_in', label: 'não é' }] },
  { field: 'state', label: 'Situação do cliente', kind: 'state', ops: [{ op: 'eq', label: 'é' }, { op: 'in', label: 'é um de' }] },
  { field: 'category', label: 'Categoria comprada', kind: 'category', ops: [{ op: 'has', label: 'já comprou' }, { op: 'not_has', label: 'nunca comprou' }] },
  { field: 'assigned_to', label: 'Responsável', kind: 'seller', ops: [{ op: 'eq', label: 'é' }, { op: 'is_null', label: 'sem responsável' }, { op: 'not_null', label: 'com responsável' }] },
  { field: 'campaign_history', label: 'Histórico em campanhas', kind: 'none', ops: [{ op: 'any', label: 'já participou de campanha' }, { op: 'none', label: 'nunca participou de campanha' }] },
  { field: 'permission', label: 'Pode ser contatado pelo canal', kind: 'channel', ops: [{ op: 'allowed', label: 'sim, no canal' }, { op: 'not_allowed', label: 'não, no canal' }] },
];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f-]{36}$/;
const CHANNELS = ['phone', 'whatsapp', 'email'];

/** Erros do critério (mesmas regras do banco). Lista vazia = válido. */
export function validateCriteria(c: unknown): string[] {
  const o = c as Partial<Criteria> | null;
  if (!o || typeof o !== 'object' || (o.match !== undefined && o.match !== 'all' && o.match !== 'any') || !Array.isArray(o.conditions)) return ['Critérios inválidos.'];
  const errs: string[] = [];
  if (o.conditions.length === 0) errs.push('Adicione ao menos uma condição.');
  if (o.conditions.length > 10) errs.push('No máximo 10 condições.');
  o.conditions.forEach((cond, i) => {
    const n = i + 1;
    const def = SEGMENT_FIELDS.find((f) => f.field === cond.field);
    if (!def) { errs.push(`Condição ${n}: campo desconhecido.`); return; }
    if (!def.ops.some((p) => p.op === cond.op)) { errs.push(`Condição ${n}: operador inválido para «${def.label}».`); return; }
    const v = cond.value;
    const bad = (msg: string) => errs.push(`Condição ${n}: ${msg}`);
    switch (def.kind) {
      case 'number': case 'money': if (typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > 1e12) bad('use um número.'); break;
      case 'date': if (typeof v !== 'string' || !DATE_RE.test(v)) bad('informe uma data AAAA-MM-DD.'); break;
      case 'segments': if (!Array.isArray(v) || v.length === 0 || v.some((s) => !(SEGMENT_KEYS as readonly string[]).includes(String(s)))) bad('escolha segmentos RFM válidos.'); break;
      case 'state':
        if (cond.op === 'eq' ? !(typeof v === 'string' && (CUSTOMER_STATES as readonly string[]).includes(v)) : !(Array.isArray(v) && v.every((s) => (CUSTOMER_STATES as readonly string[]).includes(String(s))))) bad('estado inválido.');
        break;
      case 'category': if (typeof v !== 'string' || v.length < 1 || v.length > 80) bad('informe a categoria.'); break;
      case 'seller': if (cond.op === 'eq' && !(typeof v === 'string' && UUID_RE.test(v))) bad('responsável inválido.'); break;
      case 'channel': if (typeof v !== 'string' || !CHANNELS.includes(v)) bad('informe o canal.'); break;
      default: break;
    }
  });
  return errs;
}

const brl = (cents: number) => `R$ ${(cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const CHANNEL_NAMES: Record<string, string> = { phone: 'telefone', whatsapp: 'WhatsApp', email: 'e-mail' };

/** Frase em português para um critério (usada na lista de segmentos e na campanha). */
export function describeCriteria(c: Criteria, names: Map<string, string> = new Map()): string {
  const parts = c.conditions.map((cond) => {
    const def = SEGMENT_FIELDS.find((f) => f.field === cond.field);
    if (!def) return '(condição desconhecida)';
    const op = def.ops.find((p) => p.op === cond.op)?.label ?? cond.op;
    const v = cond.value;
    switch (def.kind) {
      case 'money': return `${def.label} ${op} ${brl(Number(v))}`;
      case 'number': return `${def.label} ${op} ${Number(v).toLocaleString('pt-BR')}`;
      case 'date': return `${def.label} ${op} ${String(v).split('-').reverse().join('/')}`;
      case 'segments': return `${def.label} ${op} ${(v as string[]).map((s) => SEGMENT_LABELS[s as SegmentKey] ?? s).join(', ')}`;
      case 'state': return `${def.label} ${op} ${(Array.isArray(v) ? v : [v]).map((s) => STATE_LABELS[s as keyof typeof STATE_LABELS] ?? String(s)).join(', ')}`;
      case 'category': return `${op} «${String(v)}»`;
      case 'seller': return cond.op === 'eq' ? `${def.label} ${op} ${names.get(String(v)) ?? 'um usuário'}` : `${op}`;
      case 'channel': return `${def.label} ${CHANNEL_NAMES[String(v)] ?? String(v)}: ${op === 'sim, no canal' ? 'sim' : 'não'}`;
      default: return op;
    }
  });
  return parts.length ? parts.join(c.match === 'any' ? ' OU ' : ' E ') : 'Sem condições';
}

/** Valor inicial ao escolher um campo. */
export function defaultCondition(field: string): Condition {
  const def = SEGMENT_FIELDS.find((f) => f.field === field) ?? SEGMENT_FIELDS[0]!;
  const op = def.ops[0]!.op;
  const value: unknown = def.kind === 'number' ? 90 : def.kind === 'money' ? 100000 : def.kind === 'date' ? '2026-01-01' : def.kind === 'segments' ? ['em_risco'] : def.kind === 'state' ? 'at_risk'
    : def.kind === 'category' ? '' : def.kind === 'channel' ? 'whatsapp' : undefined;
  return { field: def.field, op, ...(value === undefined ? {} : { value }) };
}
