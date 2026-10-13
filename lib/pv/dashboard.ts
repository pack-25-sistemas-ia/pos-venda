import 'server-only';
import type { Context } from '@/lib/auth/session';
import { addDays, daysBetween, rpcArgs, type PvFilters } from './filters';

export type * from './dashboard-types';
import type { AlertCount, CampaignPoint, CampaignStat, CohortCell, DashboardData, FrequencyBand, Kpis, SegmentRow, SellerRank, SeriesPoint, StateRow } from './dashboard-types';

const num = (v: unknown): number => Number(v ?? 0);
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
type Rec = Record<string, unknown>;
const rows = (d: unknown): Rec[] => (Array.isArray(d) ? (d as Rec[]) : []);

export function toKpis(row: Rec | undefined): Kpis | null {
  return row ? {
    recent_customers: num(row.recent_customers), at_risk: num(row.at_risk), inactive: num(row.inactive), reactivated: num(row.reactivated),
    reactivation_cohort: num(row.reactivation_cohort), reactivation_cohort_done: num(row.reactivation_cohort_done), reactivation_rate: numOrNull(row.reactivation_rate),
    reactivation_revenue_cents: num(row.reactivation_revenue_cents), repurchase_buyers: num(row.repurchase_buyers), repurchase_repeat: num(row.repurchase_repeat),
    repurchase_rate: numOrNull(row.repurchase_rate), orders: num(row.orders), revenue_cents: num(row.revenue_cents), avg_ticket_cents: numOrNull(row.avg_ticket_cents),
    overdue_tasks: num(row.overdue_tasks),
  } : null;
}
export const toSeries = (d: unknown): SeriesPoint[] => rows(d).map((p) => ({
  bucket: String(p.bucket), granularity: String(p.granularity), orders: num(p.orders), revenue_cents: num(p.revenue_cents), avg_ticket_cents: numOrNull(p.avg_ticket_cents),
  repeat_orders: num(p.repeat_orders), repeat_revenue_cents: num(p.repeat_revenue_cents), reactivated: num(p.reactivated),
}));
export const toCampaignStats = (d: unknown): CampaignStat[] => rows(d).map((p) => ({
  campaign_id: String(p.campaign_id), name: String(p.name), status: String(p.status), channel: String(p.channel), eligible: num(p.eligible), excluded: num(p.excluded),
  contacted: num(p.contacted), responded: num(p.responded), response_rate: numOrNull(p.response_rate), rebought: num(p.rebought), rebought_value_cents: num(p.rebought_value_cents),
  pending_tasks: num(p.pending_tasks), created_at: String(p.created_at),
}));
export const toCampaignSeries = (d: unknown): CampaignPoint[] => rows(d).map((p) => ({ bucket: String(p.bucket), granularity: String(p.granularity), contacts: num(p.contacts), responses: num(p.responses), rebuys: num(p.rebuys) }));

export async function loadDashboard(ctx: Context, f: PvFilters): Promise<DashboardData> {
  const org = ctx.membership.organization_id;
  const db = ctx.supabase;
  const base = rpcArgs(org, f);
  const len = daysBetween(f.from, f.to) + 1;
  const prevTo = addDays(f.from, -1);
  const prevFrom = addDays(prevTo, -(len - 1));
  const [k, pk, se, st, sg, fr, co, sl, cs, al] = await Promise.all([
    db.rpc('pv_kpis', base),
    db.rpc('pv_kpis', { ...base, p_from: prevFrom, p_to: prevTo }),
    db.rpc('pv_series', base),
    db.rpc('pv_state_distribution', { p_org: org, p_to: f.to, p_seller: f.seller, p_segment: f.segment }),
    db.rpc('pv_rfm_distribution', { p_org: org, p_seller: f.seller }),
    db.rpc('pv_frequency_bands', base),
    db.rpc('pv_cohorts', { p_org: org, p_months: 6, p_seller: f.seller }),
    db.rpc('pv_seller_ranking', { p_org: org, p_from: f.from, p_to: f.to }),
    db.rpc('pv_campaign_stats', { p_org: org, p_from: f.from, p_to: f.to }),
    db.rpc('pv_alerts', { p_org: org }),
  ]);
  // coortes e ranking são complementares: o painel funciona sem eles, mas qualquer outro erro é mostrado
  const error = Boolean(k.error || se.error || st.error || sg.error || fr.error || cs.error || al.error);
  return {
    error,
    kpis: toKpis(rows(k.data)[0]),
    previous: pk.error ? null : toKpis(rows(pk.data)[0]),
    series: toSeries(se.data),
    states: rows(st.data).map((p): StateRow => ({ state: p.state as StateRow['state'], customers: num(p.customers) })),
    segments: rows(sg.data).map((p): SegmentRow => ({
      segment_key: String(p.segment_key), customers: num(p.customers), monetary_cents: num(p.monetary_cents), run_id: (p.run_id as string | null) ?? null,
      model_version: numOrNull(p.model_version), reference_date: (p.reference_date as string | null) ?? null, low_sample: Boolean(p.low_sample),
    })),
    frequency: rows(fr.data).map((p): FrequencyBand => ({ band: String(p.band), ord: num(p.ord), customers: num(p.customers) })),
    cohorts: co.error ? [] : rows(co.data).map((p): CohortCell => ({ cohort_month: String(p.cohort_month), month_offset: num(p.month_offset), customers: num(p.customers), cohort_size: num(p.cohort_size) })),
    sellers: sl.error ? [] : rows(sl.data).map((p): SellerRank => ({
      seller_id: (p.seller_id as string | null) ?? null, customers: num(p.customers), activities_done: num(p.activities_done), contacts: num(p.contacts),
      reactivated: num(p.reactivated), reactivation_revenue_cents: num(p.reactivation_revenue_cents),
    })),
    campaigns: toCampaignStats(cs.data),
    alerts: rows(al.data).map((p): AlertCount => ({ key: p.key as AlertCount['key'], customers: num(p.customers) })),
  };
}
