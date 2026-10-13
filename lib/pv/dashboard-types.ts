// Leitura dos indicadores (todos calculados em funções SQL; ver docs/METRICS.md). Nenhum número é fixo.
// «Observado» significa: aconteceu depois do contato/identificação. NÃO afirma que a ação CAUSOU a compra.
export type Kpis = {
  recent_customers: number; at_risk: number; inactive: number; reactivated: number; reactivation_cohort: number; reactivation_cohort_done: number;
  reactivation_rate: number | null; reactivation_revenue_cents: number; repurchase_buyers: number; repurchase_repeat: number; repurchase_rate: number | null;
  orders: number; revenue_cents: number; avg_ticket_cents: number | null; overdue_tasks: number;
};
export type SeriesPoint = {
  bucket: string; granularity: string; orders: number; revenue_cents: number; avg_ticket_cents: number | null; repeat_orders: number; repeat_revenue_cents: number; reactivated: number;
};
export type StateRow = { state: 'active' | 'at_risk' | 'inactive' | 'no_purchases'; customers: number };
export type SegmentRow = { segment_key: string; customers: number; monetary_cents: number; run_id: string | null; model_version: number | null; reference_date: string | null; low_sample: boolean };
export type FrequencyBand = { band: string; ord: number; customers: number };
export type CohortCell = { cohort_month: string; month_offset: number; customers: number; cohort_size: number };
export type SellerRank = { seller_id: string | null; customers: number; activities_done: number; contacts: number; reactivated: number; reactivation_revenue_cents: number };
export type CampaignStat = {
  campaign_id: string; name: string; status: string; channel: string; eligible: number; excluded: number; contacted: number; responded: number; response_rate: number | null;
  rebought: number; rebought_value_cents: number; pending_tasks: number; created_at: string;
};
export type CampaignPoint = { bucket: string; granularity: string; contacts: number; responses: number; rebuys: number };
export type AlertCount = { key: 'overdue_tasks' | 'high_priority_open' | 'near_cycle' | 'no_contact_open'; customers: number };

export type DashboardData = {
  error: boolean;
  kpis: Kpis | null;
  /** mesmos indicadores no período imediatamente anterior, de igual duração (para a variação) */
  previous: Kpis | null;
  series: SeriesPoint[];
  states: StateRow[];
  segments: SegmentRow[];
  frequency: FrequencyBand[];
  cohorts: CohortCell[];
  sellers: SellerRank[];
  campaigns: CampaignStat[];
  alerts: AlertCount[];
};
