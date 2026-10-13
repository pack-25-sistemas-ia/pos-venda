// Preparação (pura e testável) dos dados dos gráficos: rótulos legíveis, valores em reais e nomes de pessoas.
import { SEGMENT_LABELS, type SegmentKey } from './rfm';
import { STATE_LABELS } from './filters';
import { bucketLabel } from './format';
import type { CampaignStat, CohortCell, FrequencyBand, SegmentRow, SellerRank, SeriesPoint, StateRow } from './dashboard-types';

export type PeriodRow = { label: string; revenue: number; repeat: number; first: number; orders: number; ticket: number | null; reactivated: number };
export type NamedRow = { name: string; value: number };
export type SegmentChartRow = { key: string; name: string; customers: number; revenue: number };
export type StateChartRow = { key: StateRow['state']; name: string; value: number };
export type CampaignChartRow = { name: string; contacted: number; responded: number; rebought: number };
export type SellerChartRow = { name: string; contacts: number; reactivated: number; revenue: number };
export type CohortRow = { cohort: string; size: number; cells: Array<{ offset: number; customers: number; pct: number }> };

const reais = (cents: number) => Math.round(cents) / 100;

export function periodRows(series: SeriesPoint[]): PeriodRow[] {
  return series.map((p) => ({
    label: bucketLabel(p.bucket, p.granularity), revenue: reais(p.revenue_cents), repeat: reais(p.repeat_revenue_cents), first: reais(p.revenue_cents - p.repeat_revenue_cents),
    orders: p.orders, ticket: p.avg_ticket_cents === null ? null : reais(p.avg_ticket_cents), reactivated: p.reactivated,
  }));
}

export function segmentRows(rows: SegmentRow[]): SegmentChartRow[] {
  return rows.map((r) => ({ key: r.segment_key, name: SEGMENT_LABELS[r.segment_key as SegmentKey] ?? r.segment_key, customers: r.customers, revenue: reais(r.monetary_cents) }));
}

export function stateRows(rows: StateRow[]): StateChartRow[] {
  return rows.map((r) => ({ key: r.state, name: STATE_LABELS[r.state], value: r.customers }));
}

export function frequencyRows(rows: FrequencyBand[]): NamedRow[] {
  return [...rows].sort((a, b) => a.ord - b.ord).map((r) => ({ name: r.band, value: r.customers }));
}

export function campaignRows(rows: CampaignStat[]): CampaignChartRow[] {
  return rows.slice(0, 8).map((c) => ({ name: c.name.length > 22 ? `${c.name.slice(0, 21)}…` : c.name, contacted: c.contacted, responded: c.responded, rebought: c.rebought }));
}

export function sellerRows(rows: SellerRank[], labels: Map<string, string>): SellerChartRow[] {
  return rows.slice(0, 12).map((s) => ({ name: s.seller_id ? labels.get(s.seller_id) ?? 'Usuário' : 'Sem responsável', contacts: s.contacts, reactivated: s.reactivated, revenue: reais(s.reactivation_revenue_cents) }));
}

/** Retenção por coorte: % da coorte que voltou a comprar em cada mês depois do mês da primeira compra. */
export function cohortRows(cells: CohortCell[]): CohortRow[] {
  const byCohort = new Map<string, CohortRow>();
  for (const c of cells) {
    const row = byCohort.get(c.cohort_month) ?? { cohort: c.cohort_month, size: c.cohort_size, cells: [] };
    row.cells.push({ offset: c.month_offset, customers: c.customers, pct: c.cohort_size === 0 ? 0 : Math.round((c.customers / c.cohort_size) * 1000) / 10 });
    byCohort.set(c.cohort_month, row);
  }
  return [...byCohort.values()].sort((a, b) => a.cohort.localeCompare(b.cohort)).map((r) => ({ ...r, cells: r.cells.sort((a, b) => a.offset - b.offset) }));
}

export const ALERT_TITLES = {
  overdue_tasks: 'Clientes com tarefa vencida',
  high_priority_open: 'Oportunidades de prioridade alta em aberto',
  near_cycle: 'Clientes perto do fim do ciclo de recompra',
  no_contact_open: 'Oportunidades abertas há mais de 7 dias sem contato',
} as const;
export const ALERT_LINKS: Record<keyof typeof ALERT_TITLES, string> = {
  overdue_tasks: '/atividades',
  high_priority_open: '/reativacao?band=high',
  near_cycle: '/clientes?state=active',
  no_contact_open: '/reativacao',
};
