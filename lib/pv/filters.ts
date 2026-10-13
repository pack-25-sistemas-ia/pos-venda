// Filtros globais do painel e dos relatórios. Vêm da URL (compartilháveis) e SEMPRE são validados:
// período inválido cai no padrão de 90 dias, sem erro. A "data de hoje" usa o fuso da organização.
import { z } from 'zod';

export const PERIODS = ['30d', '90d', '180d', '365d', 'custom'] as const;
export type Period = (typeof PERIODS)[number];
export const CUSTOMER_STATES = ['active', 'at_risk', 'inactive', 'no_purchases'] as const;
export type CustomerState = (typeof CUSTOMER_STATES)[number];
export const SEGMENT_KEYS = ['campeoes', 'fieis', 'novos', 'promissores', 'em_risco', 'atencao', 'inativos', 'sem_compras'] as const;
export type SegmentFilter = (typeof SEGMENT_KEYS)[number];

export type PvFilters = {
  period: Period;
  /** 'YYYY-MM-DD', inclusivo. */
  from: string;
  /** 'YYYY-MM-DD', inclusivo. */
  to: string;
  seller: string | null;
  segment: SegmentFilter | null;
  category: string | null;
  status: CustomerState | null;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const uuid = z.uuid();
const MAX_SPAN_DAYS = 1095;
const PRESET_DAYS: Record<Exclude<Period, 'custom'>, number> = { '30d': 30, '90d': 90, '180d': 180, '365d': 365 };
export const DEFAULT_PERIOD: Period = '90d';
export const DEFAULT_TIMEZONE = 'America/Sao_Paulo';

/** Fuso válido (IANA)? Se não for, usa o padrão. */
export function safeTimezone(tz: string | null | undefined): string {
  if (!tz) return DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

/** Data de hoje no fuso informado, 'YYYY-MM-DD'. */
export function todayIn(tz: string = DEFAULT_TIMEZONE, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: safeTimezone(tz), year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

function toUtcMs(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
}
export function addDays(date: string, days: number): string {
  return new Date(toUtcMs(date) + days * 86_400_000).toISOString().slice(0, 10);
}
export function daysBetween(from: string, to: string): number {
  return Math.round((toUtcMs(to) - toUtcMs(from)) / 86_400_000);
}
export function isRealDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  return new Date(toUtcMs(value)).toISOString().slice(0, 10) === value;
}
function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

const CATEGORY_RE = /^[\p{L}\p{N} ._&/-]{1,80}$/u;

export function parseFilters(searchParams: Record<string, string | string[] | undefined>, today: string = todayIn()): PvFilters {
  const rawPeriod = first(searchParams.period);
  let period: Period = (PERIODS as readonly string[]).includes(rawPeriod ?? '') ? (rawPeriod as Period) : DEFAULT_PERIOD;
  let from = addDays(today, -(PRESET_DAYS[DEFAULT_PERIOD as Exclude<Period, 'custom'>] - 1));
  let to = today;
  if (period === 'custom') {
    const f = first(searchParams.from) ?? '';
    const t = first(searchParams.to) ?? '';
    if (isRealDate(f) && isRealDate(t) && f <= t && daysBetween(f, t) < MAX_SPAN_DAYS) {
      from = f;
      to = t;
    } else {
      period = DEFAULT_PERIOD;
    }
  }
  if (period !== 'custom') {
    from = addDays(today, -(PRESET_DAYS[period] - 1));
    to = today;
  }
  const seller = first(searchParams.seller);
  const seg = first(searchParams.segment);
  const st = first(searchParams.status);
  const cat = (first(searchParams.category) ?? '').trim();
  return {
    period, from, to,
    seller: seller && uuid.safeParse(seller).success ? seller : null,
    segment: (SEGMENT_KEYS as readonly string[]).includes(seg ?? '') ? (seg as SegmentFilter) : null,
    category: cat && CATEGORY_RE.test(cat) ? cat : null,
    status: (CUSTOMER_STATES as readonly string[]).includes(st ?? '') ? (st as CustomerState) : null,
  };
}

/** Query string canônica dos filtros (links de exportação e navegação). */
export function filtersToQuery(f: PvFilters): string {
  const p = new URLSearchParams();
  p.set('period', f.period);
  if (f.period === 'custom') {
    p.set('from', f.from);
    p.set('to', f.to);
  }
  if (f.seller) p.set('seller', f.seller);
  if (f.segment) p.set('segment', f.segment);
  if (f.category) p.set('category', f.category);
  if (f.status) p.set('status', f.status);
  return p.toString();
}

/** Argumentos comuns das funções SQL de indicadores com todos os filtros. */
export function rpcArgs(org: string, f: PvFilters) {
  return { p_org: org, p_from: f.from, p_to: f.to, p_seller: f.seller, p_segment: f.segment, p_category: f.category, p_status: f.status };
}

export const PERIOD_LABELS: Record<Period, string> = {
  '30d': 'Últimos 30 dias', '90d': 'Últimos 90 dias', '180d': 'Últimos 180 dias', '365d': 'Últimos 12 meses', custom: 'Período personalizado',
};
export const STATE_LABELS: Record<CustomerState, string> = { active: 'Ativo', at_risk: 'Em risco', inactive: 'Inativo', no_purchases: 'Sem compras' };
export const OPP_STATUS_LABELS = { open: 'Aberta', in_progress: 'Em andamento', reactivated: 'Reativada', discarded: 'Descartada' } as const;
export const OPP_REASON_LABELS = { inactivity: 'Inatividade', cycle: 'Ciclo de recompra vencido', frequency_drop: 'Queda de frequência', segment_change: 'Mudança de segmento' } as const;
export const CHANNEL_LABELS = { phone: 'Telefone', whatsapp: 'WhatsApp (contato manual)', email: 'E-mail (contato manual)' } as const;
export const CAMPAIGN_STATUS_LABELS = { draft: 'Rascunho', planned: 'Planejada', running: 'Em andamento', paused: 'Pausada', completed: 'Concluída', cancelled: 'Cancelada' } as const;
export const CONTACT_STATUS_LABELS = { planned: 'Planejado', contacted: 'Contatado', responded: 'Respondeu', no_response: 'Sem resposta', refused: 'Recusou' } as const;
export const PERMISSION_LABELS = { granted: 'Consentimento', legitimate_interest: 'Legítimo interesse', denied: 'Negado' } as const;
export const ACTIVITY_TYPES = ['call', 'email', 'message', 'meeting', 'follow_up', 'after_sales', 'other'] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];
export const ACTIVITY_LABELS: Record<ActivityType, string> = {
  call: 'Ligação', email: 'E-mail', message: 'Mensagem', meeting: 'Reunião', follow_up: 'Acompanhamento', after_sales: 'Pós-venda', other: 'Outro',
};

/** Instante UTC (ISO) do meio-dia da data `YYYY-MM-DD` no fuso informado. Compras guardam o dia, não a hora. */
export function zonedNoonIso(date: string, tz: string = DEFAULT_TIMEZONE): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const guess = Date.UTC(y, m - 1, d, 12);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: safeTimezone(tz), hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(guess));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const local = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return new Date(guess - (local - guess)).toISOString();
}
