// Formatação no padrão brasileiro. Datas de calendário ('YYYY-MM-DD') nunca passam por fuso; instantes usam o fuso da organização.
import { safeTimezone } from './filters';

const pct = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const int = new Intl.NumberFormat('pt-BR');
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const brlCompact = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact', maximumFractionDigits: 1 });

/** Valor monetário a partir de centavos. `null` (sem dados) vira "—". */
export function formatBRL(cents: number | null | undefined): string {
  return cents === null || cents === undefined || !Number.isFinite(cents) ? '—' : brl.format(cents / 100);
}
export function formatBRLCompact(cents: number | null | undefined): string {
  return cents === null || cents === undefined || !Number.isFinite(cents) ? '—' : brlCompact.format(cents / 100);
}
/** Percentual com uma casa; `null` (sem dados) vira "—", nunca "0%". */
export function formatPct(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value) ? '—' : `${pct.format(value)}%`;
}
export function formatInt(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value) ? '—' : int.format(value);
}
/** Dias -> "12 dias", "1 dia". */
export function formatDays(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${int.format(value)} ${value === 1 ? 'dia' : 'dias'}`;
}

/** 'YYYY-MM-DD' -> 'DD/MM/AAAA' sem deslocamento de fuso. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '—';
}
export function formatDateTime(value: string | null | undefined, tz?: string): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: safeTimezone(tz) }).format(d);
}
export function formatDay(value: string | null | undefined, tz?: string): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: safeTimezone(tz) }).format(d);
}

/** Telefone guardado só com dígitos (ex.: 5511912345678) -> "+55 (11) 91234-5678". Outros formatos voltam como estão. */
export function formatPhone(value: string | null | undefined): string {
  const d = (value ?? '').replace(/\D/g, '');
  if (!d) return '';
  if (d.length === 13 && d.startsWith('55')) return `+55 (${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}`;
  if (d.length === 12 && d.startsWith('55')) return `+55 (${d.slice(2, 4)}) ${d.slice(4, 8)}-${d.slice(8)}`;
  return `+${d}`;
}

/** CPF/CNPJ guardado só com dígitos -> máscara. Mostrado apenas a quem pode ver o cliente. */
export function formatDocument(value: string | null | undefined): string {
  const d = (value ?? '').replace(/\D/g, '');
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  if (d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  return d;
}

export type Tone = 'success' | 'danger' | 'warning' | 'neutral';
/** Cor do estado do cliente (sempre acompanhada de texto; nunca só cor). */
export function stateTone(state: string | null | undefined): Tone {
  return state === 'active' ? 'success' : state === 'at_risk' ? 'warning' : state === 'inactive' ? 'danger' : 'neutral';
}
export function segmentTone(segment: string | null | undefined): Tone {
  switch (segment) {
    case 'campeoes': case 'fieis': return 'success';
    case 'atencao': case 'em_risco': return 'warning';
    case 'inativos': return 'danger';
    default: return 'neutral';
  }
}
export function priorityTone(priority: number, high = 70, medium = 40): Tone {
  return priority >= high ? 'danger' : priority >= medium ? 'warning' : 'neutral';
}
export function priorityLabel(priority: number, high = 70, medium = 40): string {
  return priority >= high ? 'Alta' : priority >= medium ? 'Média' : 'Baixa';
}

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
/** Rótulo do ponto da série: dia/semana -> "31/08"; mês -> "set/26". */
export function bucketLabel(bucket: string, granularity: string): string {
  const [y, m, d] = bucket.split('-');
  if (!y || !m || !d) return bucket;
  return granularity === 'month' ? `${MONTHS[Number(m) - 1] ?? m}/${y.slice(2)}` : `${d}/${m}`;
}

/** Variação percentual entre períodos; `null` quando não faz sentido (base zero ou ausente). */
export function variationPct(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

import { ACTIVITY_LABELS, type ActivityType } from './filters';
export const activityLabel = (t: string) => ACTIVITY_LABELS[t as ActivityType] ?? t;
/** Tarefa vencida? (prazo no passado) */
export function overdue(a: { due_at: string | null }, now: number): boolean {
  return a.due_at !== null && Date.parse(a.due_at) < now;
}
