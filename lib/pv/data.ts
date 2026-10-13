import 'server-only';
import type { Context } from '@/lib/auth/session';
import { safeTimezone, todayIn as todayInTz, type CustomerState } from './filters';
import type { Criteria } from './segments';
import { firstName, type TemplateVars } from './templates';

// ------------------------------------------------------------------ tipos das linhas
export type Person = { user_id: string; label: string };
export type SettingsRow = {
  organization_id: string; timezone: string; rfm_window_days: number; rfm_mode: 'percentile' | 'fixed'; rfm_limits: { r: number[]; f: number[]; m: number[] };
  new_customer_days: number; risk_days: number; inactive_days: number; cycle_factor: number; cycle_min_purchases: number; cycle_min_days: number;
  drop_window_days: number; drop_pct: number; drop_min_prev: number; rule_inactivity: boolean; rule_cycle: boolean; rule_drop: boolean; rule_segment_change: boolean;
  observation_days: number; w_value: number; w_frequency: number; w_overdue: number; priority_high: number; priority_medium: number; alert_overdue_tasks: boolean;
};
export const SETTINGS_COLUMNS = 'organization_id, timezone, rfm_window_days, rfm_mode, rfm_limits, new_customer_days, risk_days, inactive_days, cycle_factor, cycle_min_purchases, cycle_min_days, drop_window_days, drop_pct, drop_min_prev, rule_inactivity, rule_cycle, rule_drop, rule_segment_change, observation_days, w_value, w_frequency, w_overdue, priority_high, priority_medium, alert_overdue_tasks';

export type CustomerRow = {
  id: string; name: string; email: string | null; phone: string | null; company_name: string | null; document_number: string | null; customer_type: 'person' | 'company';
  status: 'active' | 'archived'; external_customer_id: string | null; assigned_to: string | null; notes: string | null; anonymized_at: string | null;
  created_at: string; updated_at: string; archived_at: string | null;
};
export const CUSTOMER_COLUMNS = 'id, name, email, phone, company_name, document_number, customer_type, status, external_customer_id, assigned_to, notes, anonymized_at, created_at, updated_at, archived_at';

export type Signal = {
  customer_id: string; n_valid: number; first_at: string | null; last_at: string | null; days_since: number | null; net_total_cents: number; median_interval: number | null;
  median_ticket_cents: number | null; orders_recent: number; orders_prev: number; state: CustomerState; signals: string[];
};
export type SegmentOf = { segment_key: string; r_score: number | null; f_score: number | null; m_score: number | null; model_version: number };
export type PurchaseRow = {
  id: string; customer_id: string; external_order_id: string | null; purchased_at: string; total_cents: number; refunded_cents: number; net_cents: number;
  status: 'completed' | 'cancelled'; is_valid: boolean; source: string | null; notes: string | null; created_at: string;
};
export const PURCHASE_COLUMNS = 'id, customer_id, external_order_id, purchased_at, total_cents, refunded_cents, net_cents, status, is_valid, source, notes, created_at';
export type ItemRow = { id: string; purchase_id: string; product_name: string; product_sku: string | null; category: string | null; quantity: number; unit_price_cents: number; total_cents: number };
export type OpportunityRow = {
  id: string; customer_id: string; reason: 'inactivity' | 'cycle' | 'frequency_drop' | 'segment_change'; priority: number; estimated_value_cents: number | null;
  explanation_json: Record<string, unknown>; status: 'open' | 'in_progress' | 'reactivated' | 'discarded'; assigned_to: string | null; next_action: string | null; discard_reason: string | null;
  last_contact_at: string | null; reactivated_purchase_id: string | null; identified_at: string; resolved_at: string | null;
};
export const OPPORTUNITY_COLUMNS = 'id, customer_id, reason, priority, estimated_value_cents, explanation_json, status, assigned_to, next_action, discard_reason, last_contact_at, reactivated_purchase_id, identified_at, resolved_at';
export type SegmentDef = { id: string; name: string; description: string | null; criteria_json: Criteria; segment_type: 'custom' | 'system'; active: boolean; created_at: string; updated_at: string };
export type CampaignRow = {
  id: string; name: string; description: string | null; objective: string | null; channel: 'phone' | 'whatsapp' | 'email'; status: 'draft' | 'planned' | 'running' | 'paused' | 'completed' | 'cancelled';
  segment_id: string | null; message_body: string | null; message_subject: string | null; owner_id: string | null; observation_days: number; scheduled_at: string | null;
  started_at: string | null; completed_at: string | null; created_at: string;
};
export const CAMPAIGN_COLUMNS = 'id, name, description, objective, channel, status, segment_id, message_body, message_subject, owner_id, observation_days, scheduled_at, started_at, completed_at, created_at';
export type MembershipRow = { id: string; campaign_id: string; customer_id: string; status: string; exclusion_reason: string | null; assigned_to: string | null; eligibility_snapshot_json: Record<string, unknown> };
export type ContactRow = { id: string; campaign_id: string; customer_id: string; contact_method: string; contact_status: 'planned' | 'contacted' | 'responded' | 'no_response' | 'refused'; contacted_by: string | null; contacted_at: string | null; notes: string | null; created_at: string };
export type OutcomeRow = { id: string; campaign_id: string; customer_id: string; related_purchase_id: string; outcome_at: string };
export type TemplateRow = { id: string; template_key: string; name: string; channel: 'phone' | 'whatsapp' | 'email'; subject: string | null; body: string; active: boolean };
export type ActivityRow = {
  id: string; customer_id: string; user_id: string | null; assigned_to: string | null; type: string; title: string | null; description: string | null; priority: 'low' | 'normal' | 'high';
  campaign_id: string | null; opportunity_id: string | null; due_at: string | null; completed_at: string | null; created_at: string;
};
export const ACTIVITY_COLUMNS = 'id, customer_id, user_id, assigned_to, type, title, description, priority, campaign_id, opportunity_id, due_at, completed_at, created_at';
export type PreferenceRow = { id: string; customer_id: string; channel: 'phone' | 'whatsapp' | 'email'; permission_status: 'granted' | 'legitimate_interest' | 'denied'; legal_basis_reference: string | null; updated_at: string };
export type SuppressionRow = { id: string; customer_id: string; channel: 'phone' | 'whatsapp' | 'email' | null; reason: string; created_at: string; lifted_at: string | null };
export type NotificationRow = { id: string; type: string; title: string; body: string | null; link: string | null; read_at: string | null; created_at: string };
export type ImportJobRow = { id: string; kind: 'customers' | 'purchases'; file_name: string; status: string; total_rows: number; accepted_rows: number; rejected_rows: number; duplicate_rows: number; created_at: string; completed_at: string | null };
export type RfmRun = { id: string; model_version: number; reference_date: string; window_days: number; mode: string; scored_count: number; low_sample: boolean; created_at: string; params_json: Record<string, unknown> };
export type LifecycleEvent = { id: number; event_type: string; metadata: Record<string, unknown>; occurred_at: string };

export const PAGE_SIZE = 20;
/** Teto de clientes carregados por tela (estado e segmento são calculados à parte, em memória). */
export const CUSTOMER_LOAD_LIMIT = 5000;

export function parsePage(value: string | string[] | undefined): number {
  const v = Array.isArray(value) ? value[0] : value;
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 10_000 ? n : 1;
}

/** Termo de busca seguro para filtros PostgREST: só letras, números, espaço e . _ - @. Remove vírgula, parênteses, asteriscos e aspas. */
export function searchToken(q: string | string[] | undefined): string {
  const v = (Array.isArray(q) ? q[0] : q) ?? '';
  return v.normalize('NFC').replace(/[^\p{L}\p{N} ._@-]/gu, '').trim().slice(0, 60);
}

export const labelMap = (people: Person[]) => new Map(people.map((p) => [p.user_id, p.label]));
export const personOptions = (people: Person[]) => people.map((p) => ({ value: p.user_id, label: p.label }));

const DEFAULT_SETTINGS: Omit<SettingsRow, 'organization_id'> = {
  timezone: 'America/Sao_Paulo', rfm_window_days: 365, rfm_mode: 'percentile', rfm_limits: { r: [30, 60, 90, 180], f: [2, 3, 5, 8], m: [10000, 30000, 100000, 300000] },
  new_customer_days: 30, risk_days: 90, inactive_days: 180, cycle_factor: 1.5, cycle_min_purchases: 3, cycle_min_days: 15, drop_window_days: 90, drop_pct: 50, drop_min_prev: 2,
  rule_inactivity: true, rule_cycle: true, rule_drop: true, rule_segment_change: true, observation_days: 30, w_value: 40, w_frequency: 20, w_overdue: 40,
  priority_high: 70, priority_medium: 40, alert_overdue_tasks: true,
};

export async function loadSettings(ctx: Context): Promise<SettingsRow> {
  const org = ctx.membership.organization_id;
  const { data } = await ctx.supabase.from('pv_settings').select(SETTINGS_COLUMNS).eq('organization_id', org).maybeSingle();
  const row = (data ?? { organization_id: org, ...DEFAULT_SETTINGS }) as unknown as SettingsRow;
  return { ...row, cycle_factor: Number(row.cycle_factor), timezone: safeTimezone(row.timezone) };
}

export async function loadPeople(ctx: Context): Promise<Person[]> {
  const { data } = await ctx.supabase.rpc('pv_user_labels', { p_org: ctx.membership.organization_id });
  return ((data ?? []) as Person[]).sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
}

// ------------------------------------------------------------------ sinais, RFM
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export async function loadSignals(ctx: Context, ref: string): Promise<Map<string, Signal>> {
  const { data } = await ctx.supabase.rpc('pv_customer_signals', { p_org: ctx.membership.organization_id, p_ref: ref });
  const map = new Map<string, Signal>();
  for (const r of (data ?? []) as Array<Record<string, unknown>>) {
    map.set(String(r.customer_id), {
      customer_id: String(r.customer_id), n_valid: Number(r.n_valid ?? 0), first_at: (r.first_at as string | null) ?? null, last_at: (r.last_at as string | null) ?? null,
      days_since: numOrNull(r.days_since), net_total_cents: Number(r.net_total_cents ?? 0), median_interval: numOrNull(r.median_interval), median_ticket_cents: numOrNull(r.median_ticket_cents),
      orders_recent: Number(r.orders_recent ?? 0), orders_prev: Number(r.orders_prev ?? 0), state: r.state as CustomerState, signals: (r.signals as string[] | null) ?? [],
    });
  }
  return map;
}

export async function latestRun(ctx: Context): Promise<RfmRun | null> {
  const { data } = await ctx.supabase.from('rfm_runs').select('id, model_version, reference_date, window_days, mode, scored_count, low_sample, created_at, params_json')
    .eq('organization_id', ctx.membership.organization_id).order('model_version', { ascending: false }).limit(1);
  return ((data ?? [])[0] as RfmRun | undefined) ?? null;
}
export async function listRuns(ctx: Context, limit = 12): Promise<RfmRun[]> {
  const { data } = await ctx.supabase.from('rfm_runs').select('id, model_version, reference_date, window_days, mode, scored_count, low_sample, created_at, params_json')
    .eq('organization_id', ctx.membership.organization_id).order('model_version', { ascending: false }).limit(limit);
  return (data ?? []) as RfmRun[];
}

/** Segmento RFM de cada cliente na rodada mais recente. */
export async function currentSegments(ctx: Context, run: RfmRun | null): Promise<Map<string, SegmentOf>> {
  const map = new Map<string, SegmentOf>();
  if (!run) return map;
  const { data } = await ctx.supabase.from('customer_rfm_scores').select('customer_id, segment_key, r_score, f_score, m_score, model_version').eq('run_id', run.id).limit(CUSTOMER_LOAD_LIMIT * 2);
  for (const r of (data ?? []) as Array<SegmentOf & { customer_id: string }>) map.set(r.customer_id, { segment_key: r.segment_key, r_score: r.r_score, f_score: r.f_score, m_score: r.m_score, model_version: r.model_version });
  return map;
}

// ------------------------------------------------------------------ clientes
export type CustomerQuery = { q: string; state: string; segment: string; seller: string; unassigned: boolean; archived: boolean; page: number };
export type CustomerListRow = CustomerRow & { signal: Signal | null; segment: SegmentOf | null };

export async function listCustomers(ctx: Context, f: CustomerQuery, today: string): Promise<{ rows: CustomerListRow[]; total: number; truncated: boolean }> {
  let query = ctx.supabase.from('customers').select(CUSTOMER_COLUMNS).eq('organization_id', ctx.membership.organization_id);
  query = f.archived ? query.not('archived_at', 'is', null) : query.is('archived_at', null);
  if (f.seller) query = query.eq('assigned_to', f.seller);
  if (f.unassigned) query = query.is('assigned_to', null);
  if (f.q) {
    const digits = f.q.replace(/\D/g, '');
    const parts = [`name.ilike.%${f.q}%`, `email.ilike.%${f.q}%`, `company_name.ilike.%${f.q}%`];
    if (digits.length >= 4) parts.push(`phone.ilike.%${digits}%`, `document_number.ilike.%${digits}%`);
    query = query.or(parts.join(','));
  }
  const { data } = await query.order('name').limit(CUSTOMER_LOAD_LIMIT + 1);
  const all = (data ?? []) as CustomerRow[];
  const truncated = all.length > CUSTOMER_LOAD_LIMIT;
  const [signals, run] = await Promise.all([loadSignals(ctx, today), latestRun(ctx)]);
  const segs = await currentSegments(ctx, run);
  let rows: CustomerListRow[] = all.slice(0, CUSTOMER_LOAD_LIMIT).map((c) => ({ ...c, signal: signals.get(c.id) ?? null, segment: segs.get(c.id) ?? null }));
  if (f.state) rows = rows.filter((r) => r.signal?.state === f.state);
  if (f.segment) rows = rows.filter((r) => (r.segment?.segment_key ?? 'sem_compras') === f.segment);
  const total = rows.length;
  const from = (f.page - 1) * PAGE_SIZE;
  return { rows: rows.slice(from, from + PAGE_SIZE), total, truncated };
}

export async function customerOptions(ctx: Context, limit = 500): Promise<Array<{ value: string; label: string }>> {
  const { data } = await ctx.supabase.from('customers').select('id, name, email').eq('organization_id', ctx.membership.organization_id).is('archived_at', null).order('name').limit(limit);
  return ((data ?? []) as Array<{ id: string; name: string; email: string | null }>).map((c) => ({ value: c.id, label: c.email ? `${c.name} — ${c.email}` : c.name }));
}

export async function customerNames(ctx: Context, ids: string[]): Promise<Map<string, string>> {
  const uniq = [...new Set(ids)];
  if (uniq.length === 0) return new Map();
  const { data } = await ctx.supabase.from('customers').select('id, name').in('id', uniq);
  return new Map(((data ?? []) as Array<{ id: string; name: string }>).map((x) => [x.id, x.name]));
}

export type CustomerDetail = {
  customer: CustomerRow; signal: Signal | null; segment: SegmentOf | null; history: Array<{ model_version: number; reference_date: string; segment_key: string; r_score: number | null; f_score: number | null; m_score: number | null }>;
  purchases: PurchaseRow[]; items: Map<string, ItemRow[]>; events: LifecycleEvent[]; opportunities: OpportunityRow[]; activities: ActivityRow[];
  preferences: PreferenceRow[]; suppressions: SuppressionRow[]; campaigns: Array<{ campaign: CampaignRow; membership: MembershipRow; contacts: ContactRow[] }>;
  lastProduct: string | null;
};

export async function loadCustomer(ctx: Context, id: string, today: string): Promise<CustomerDetail | null> {
  const db = ctx.supabase;
  const org = ctx.membership.organization_id;
  const { data: c } = await db.from('customers').select(CUSTOMER_COLUMNS).eq('id', id).eq('organization_id', org).maybeSingle();
  if (!c) return null;
  const [signals, run, pur, ev, opp, act, pref, sup, mem, hist] = await Promise.all([
    loadSignals(ctx, today),
    latestRun(ctx),
    db.from('purchases').select(PURCHASE_COLUMNS).eq('customer_id', id).order('purchased_at', { ascending: false }).limit(100),
    db.from('customer_lifecycle_events').select('id, event_type, metadata, occurred_at').eq('customer_id', id).order('occurred_at', { ascending: false }).limit(60),
    db.from('reactivation_opportunities').select(OPPORTUNITY_COLUMNS).eq('customer_id', id).order('identified_at', { ascending: false }).limit(30),
    db.from('customer_activities').select(ACTIVITY_COLUMNS).eq('customer_id', id).order('created_at', { ascending: false }).limit(100),
    db.from('communication_preferences').select('id, customer_id, channel, permission_status, legal_basis_reference, updated_at').eq('customer_id', id),
    db.from('suppression_entries').select('id, customer_id, channel, reason, created_at, lifted_at').eq('customer_id', id).order('created_at', { ascending: false }).limit(20),
    db.from('campaign_memberships').select('id, campaign_id, customer_id, status, exclusion_reason, assigned_to, eligibility_snapshot_json').eq('customer_id', id).limit(30),
    db.from('customer_rfm_scores').select('model_version, reference_date, segment_key, r_score, f_score, m_score').eq('customer_id', id).order('model_version', { ascending: false }).limit(12),
  ]);
  const purchases = (pur.data ?? []) as PurchaseRow[];
  const ids = purchases.map((p) => p.id);
  const { data: items } = ids.length ? await db.from('purchase_items').select('id, purchase_id, product_name, product_sku, category, quantity, unit_price_cents, total_cents').in('purchase_id', ids) : { data: [] };
  const byPurchase = new Map<string, ItemRow[]>();
  for (const it of (items ?? []) as ItemRow[]) byPurchase.set(it.purchase_id, [...(byPurchase.get(it.purchase_id) ?? []), it]);
  const memberships = (mem.data ?? []) as MembershipRow[];
  const campIds = memberships.map((m) => m.campaign_id);
  const [camps, contacts] = campIds.length
    ? await Promise.all([
      db.from('campaigns').select(CAMPAIGN_COLUMNS).in('id', campIds),
      db.from('campaign_contacts').select('id, campaign_id, customer_id, contact_method, contact_status, contacted_by, contacted_at, notes, created_at').eq('customer_id', id).in('campaign_id', campIds).order('created_at', { ascending: false }),
    ])
    : [{ data: [] }, { data: [] }];
  const campMap = new Map(((camps.data ?? []) as CampaignRow[]).map((x) => [x.id, x]));
  const contactList = (contacts.data ?? []) as ContactRow[];
  const lastValid = purchases.find((p) => p.is_valid);
  const lastProduct = lastValid ? (byPurchase.get(lastValid.id) ?? [])[0]?.product_name ?? null : null;
  return {
    customer: c as CustomerRow, signal: signals.get(id) ?? null, segment: (await currentSegments(ctx, run)).get(id) ?? null,
    history: (hist.data ?? []) as CustomerDetail['history'], purchases, items: byPurchase, events: (ev.data ?? []) as LifecycleEvent[],
    opportunities: (opp.data ?? []) as OpportunityRow[], activities: (act.data ?? []) as ActivityRow[], preferences: (pref.data ?? []) as PreferenceRow[],
    suppressions: (sup.data ?? []) as SuppressionRow[],
    campaigns: memberships.flatMap((m) => { const camp = campMap.get(m.campaign_id); return camp ? [{ campaign: camp, membership: m, contacts: contactList.filter((k) => k.campaign_id === m.campaign_id) }] : []; }),
    lastProduct,
  };
}

// ------------------------------------------------------------------ compras
export type PurchaseQuery = { q: string; status: string; customer: string; from: string; to: string; page: number };
export type PurchaseListRow = PurchaseRow & { customer_name: string };

export async function listPurchases(ctx: Context, f: PurchaseQuery): Promise<{ rows: PurchaseListRow[]; total: number }> {
  let query = ctx.supabase.from('purchases').select(PURCHASE_COLUMNS, { count: 'exact' }).eq('organization_id', ctx.membership.organization_id);
  if (f.status === 'valid') query = query.eq('is_valid', true);
  else if (f.status === 'cancelled') query = query.eq('status', 'cancelled');
  else if (f.status === 'refunded') query = query.gt('refunded_cents', 0);
  if (f.customer) query = query.eq('customer_id', f.customer);
  if (f.from) query = query.gte('purchased_at', `${f.from}T00:00:00-03:00`);
  if (f.to) query = query.lte('purchased_at', `${f.to}T23:59:59-03:00`);
  if (f.q) query = query.ilike('external_order_id', `%${f.q}%`);
  const from = (f.page - 1) * PAGE_SIZE;
  const { data, count } = await query.order('purchased_at', { ascending: false }).range(from, from + PAGE_SIZE - 1);
  const rows = (data ?? []) as PurchaseRow[];
  const names = await customerNames(ctx, rows.map((r) => r.customer_id));
  return { rows: rows.map((r) => ({ ...r, customer_name: names.get(r.customer_id) ?? 'Cliente' })), total: count ?? 0 };
}

// ------------------------------------------------------------------ oportunidades
export type OpportunityQuery = { status: string; reason: string; seller: string; band: string; page: number };
export type OpportunityListRow = OpportunityRow & { customer_name: string; days_since: number | null; segment_key: string | null };

export async function listOpportunities(ctx: Context, f: OpportunityQuery, high: number, medium: number): Promise<{ rows: OpportunityListRow[]; total: number }> {
  let query = ctx.supabase.from('reactivation_opportunities').select(OPPORTUNITY_COLUMNS, { count: 'exact' }).eq('organization_id', ctx.membership.organization_id);
  query = f.status === 'all' ? query : f.status ? query.eq('status', f.status) : query.in('status', ['open', 'in_progress']);
  if (f.reason) query = query.eq('reason', f.reason);
  if (f.seller) query = query.eq('assigned_to', f.seller);
  if (f.band === 'high') query = query.gte('priority', high);
  else if (f.band === 'medium') query = query.gte('priority', medium).lt('priority', high);
  else if (f.band === 'low') query = query.lt('priority', medium);
  const from = (f.page - 1) * PAGE_SIZE;
  const { data, count } = await query.order('priority', { ascending: false }).order('identified_at', { ascending: false }).range(from, from + PAGE_SIZE - 1);
  const rows = (data ?? []) as OpportunityRow[];
  const names = await customerNames(ctx, rows.map((r) => r.customer_id));
  const run = await latestRun(ctx);
  const segs = await currentSegments(ctx, run);
  return {
    rows: rows.map((r) => ({
      ...r, customer_name: names.get(r.customer_id) ?? 'Cliente', segment_key: segs.get(r.customer_id)?.segment_key ?? null,
      days_since: typeof r.explanation_json.days_since_last === 'number' ? (r.explanation_json.days_since_last as number) : null,
    })),
    total: count ?? 0,
  };
}

// ------------------------------------------------------------------ segmentos e campanhas
export async function listSegmentDefs(ctx: Context): Promise<Array<SegmentDef & { members: number }>> {
  const org = ctx.membership.organization_id;
  const { data } = await ctx.supabase.from('segment_definitions').select('id, name, description, criteria_json, segment_type, active, created_at, updated_at').eq('organization_id', org).order('created_at');
  const defs = (data ?? []) as SegmentDef[];
  const counts = new Map<string, number>();
  if (defs.length) {
    const { data: mem } = await ctx.supabase.from('segment_memberships').select('segment_id').eq('organization_id', org).limit(50000);
    for (const r of (mem ?? []) as Array<{ segment_id: string }>) counts.set(r.segment_id, (counts.get(r.segment_id) ?? 0) + 1);
  }
  return defs.map((d) => ({ ...d, members: counts.get(d.id) ?? 0 }));
}

export async function listCampaigns(ctx: Context): Promise<CampaignRow[]> {
  const { data } = await ctx.supabase.from('campaigns').select(CAMPAIGN_COLUMNS).eq('organization_id', ctx.membership.organization_id).order('created_at', { ascending: false });
  return (data ?? []) as CampaignRow[];
}

export type CampaignDetail = {
  campaign: CampaignRow; segment: SegmentDef | null; memberships: Array<MembershipRow & { customer_name: string }>; contacts: ContactRow[]; outcomes: Array<OutcomeRow & { net_cents: number }>; activities: ActivityRow[];
};
export async function loadCampaign(ctx: Context, id: string): Promise<CampaignDetail | null> {
  const db = ctx.supabase;
  const org = ctx.membership.organization_id;
  const { data: camp } = await db.from('campaigns').select(CAMPAIGN_COLUMNS).eq('id', id).eq('organization_id', org).maybeSingle();
  if (!camp) return null;
  const c = camp as CampaignRow;
  const [seg, mem, con, out, act] = await Promise.all([
    c.segment_id ? db.from('segment_definitions').select('id, name, description, criteria_json, segment_type, active, created_at, updated_at').eq('id', c.segment_id).maybeSingle() : Promise.resolve({ data: null }),
    db.from('campaign_memberships').select('id, campaign_id, customer_id, status, exclusion_reason, assigned_to, eligibility_snapshot_json').eq('campaign_id', id).limit(2000),
    db.from('campaign_contacts').select('id, campaign_id, customer_id, contact_method, contact_status, contacted_by, contacted_at, notes, created_at').eq('campaign_id', id).order('created_at', { ascending: false }).limit(2000),
    db.from('campaign_outcomes').select('id, campaign_id, customer_id, related_purchase_id, outcome_at').eq('campaign_id', id).limit(2000),
    db.from('customer_activities').select(ACTIVITY_COLUMNS).eq('campaign_id', id).order('created_at', { ascending: false }).limit(200),
  ]);
  const memberships = (mem.data ?? []) as MembershipRow[];
  const names = await customerNames(ctx, memberships.map((m) => m.customer_id));
  const outcomes = (out.data ?? []) as OutcomeRow[];
  const pids = outcomes.map((o) => o.related_purchase_id);
  const { data: pur } = pids.length ? await db.from('purchases').select('id, net_cents').in('id', pids) : { data: [] };
  const net = new Map(((pur ?? []) as Array<{ id: string; net_cents: number }>).map((p) => [p.id, Number(p.net_cents)]));
  return {
    campaign: c, segment: (seg.data as SegmentDef | null) ?? null,
    memberships: memberships.map((m) => ({ ...m, customer_name: names.get(m.customer_id) ?? 'Cliente' })).sort((a, b) => a.customer_name.localeCompare(b.customer_name, 'pt-BR')),
    contacts: (con.data ?? []) as ContactRow[], outcomes: outcomes.map((o) => ({ ...o, net_cents: net.get(o.related_purchase_id) ?? 0 })), activities: (act.data ?? []) as ActivityRow[],
  };
}

export async function listTemplates(ctx: Context): Promise<TemplateRow[]> {
  const { data } = await ctx.supabase.from('message_templates').select('id, template_key, name, channel, subject, body, active').eq('organization_id', ctx.membership.organization_id).order('name');
  return (data ?? []) as TemplateRow[];
}

// ------------------------------------------------------------------ tarefas, notificações, importações
export type ActivityListRow = ActivityRow & { customer_name: string };
export async function listOpenActivities(ctx: Context, mine: boolean): Promise<ActivityListRow[]> {
  let q = ctx.supabase.from('customer_activities').select(ACTIVITY_COLUMNS).eq('organization_id', ctx.membership.organization_id).is('completed_at', null);
  if (mine) q = q.or(`assigned_to.eq.${ctx.user.id},user_id.eq.${ctx.user.id}`);
  const { data } = await q.order('due_at', { ascending: true, nullsFirst: false }).limit(200);
  const acts = (data ?? []) as ActivityRow[];
  const names = await customerNames(ctx, acts.map((a) => a.customer_id));
  return acts.map((a) => ({ ...a, customer_name: names.get(a.customer_id) ?? 'Cliente' }));
}

export async function listNotifications(ctx: Context, limit = 50): Promise<NotificationRow[]> {
  const { data } = await ctx.supabase.from('notifications').select('id, type, title, body, link, read_at, created_at').eq('organization_id', ctx.membership.organization_id).eq('user_id', ctx.user.id)
    .order('created_at', { ascending: false }).limit(limit);
  return (data ?? []) as NotificationRow[];
}

export async function listImportJobs(ctx: Context, limit = 10): Promise<ImportJobRow[]> {
  const { data } = await ctx.supabase.from('import_jobs').select('id, kind, file_name, status, total_rows, accepted_rows, rejected_rows, duplicate_rows, created_at, completed_at')
    .eq('organization_id', ctx.membership.organization_id).order('created_at', { ascending: false }).limit(limit);
  return (data ?? []) as ImportJobRow[];
}

/** Categorias já usadas nas compras (para o filtro). */
export async function listCategories(ctx: Context): Promise<string[]> {
  const { data } = await ctx.supabase.from('purchase_items').select('category').eq('organization_id', ctx.membership.organization_id).not('category', 'is', null).limit(5000);
  return [...new Set(((data ?? []) as Array<{ category: string | null }>).map((r) => r.category as string))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

export async function loadOpportunity(ctx: Context, id: string): Promise<{ opp: OpportunityRow; customer: CustomerRow | null; signal: Signal | null; segment: SegmentOf | null; activities: ActivityRow[] } | null> {
  const db = ctx.supabase;
  const { data } = await db.from('reactivation_opportunities').select(OPPORTUNITY_COLUMNS).eq('id', id).eq('organization_id', ctx.membership.organization_id).maybeSingle();
  if (!data) return null;
  const opp = data as OpportunityRow;
  const settings = await loadSettings(ctx);
  const [{ data: cust }, signals, run, { data: acts }] = await Promise.all([
    db.from('customers').select(CUSTOMER_COLUMNS).eq('id', opp.customer_id).maybeSingle(),
    loadSignals(ctx, todayInTz(settings.timezone)),
    latestRun(ctx),
    db.from('customer_activities').select(ACTIVITY_COLUMNS).eq('opportunity_id', id).order('created_at', { ascending: false }).limit(50),
  ]);
  const segs = await currentSegments(ctx, run);
  return { opp, customer: (cust as CustomerRow | null) ?? null, signal: signals.get(opp.customer_id) ?? null, segment: segs.get(opp.customer_id) ?? null, activities: (acts ?? []) as ActivityRow[] };
}

/** Variáveis do modelo de mensagem de cada cliente (nome, última compra, produto, responsável…). Só para exibir/copiar; nada é enviado. */
export async function loadMemberVars(ctx: Context, ids: string[], labels: Map<string, string>, today: string): Promise<Map<string, TemplateVars>> {
  const out = new Map<string, TemplateVars>();
  const uniq = [...new Set(ids)];
  if (uniq.length === 0) return out;
  const db = ctx.supabase;
  const [{ data: custs }, signals, { data: purs }] = await Promise.all([
    db.from('customers').select('id, name, company_name, assigned_to').in('id', uniq.slice(0, 2000)),
    loadSignals(ctx, today),
    db.from('purchases').select('id, customer_id, purchased_at').in('customer_id', uniq.slice(0, 2000)).eq('is_valid', true).order('purchased_at', { ascending: false }).limit(6000),
  ]);
  const lastPurchase = new Map<string, string>();
  for (const p of (purs ?? []) as Array<{ id: string; customer_id: string }>) if (!lastPurchase.has(p.customer_id)) lastPurchase.set(p.customer_id, p.id);
  const pids = [...lastPurchase.values()];
  const { data: items } = pids.length ? await db.from('purchase_items').select('purchase_id, product_name').in('purchase_id', pids.slice(0, 2000)) : { data: [] };
  const product = new Map<string, string>();
  for (const it of (items ?? []) as Array<{ purchase_id: string; product_name: string }>) if (!product.has(it.purchase_id)) product.set(it.purchase_id, it.product_name);
  for (const c of (custs ?? []) as Array<{ id: string; name: string; company_name: string | null; assigned_to: string | null }>) {
    const s = signals.get(c.id);
    out.set(c.id, {
      nome: c.name, primeiro_nome: firstName(c.name), empresa: c.company_name, ultima_compra: s?.last_at ? s.last_at.split('-').reverse().join('/') : null,
      dias_sem_comprar: s?.days_since == null ? null : String(s.days_since), produto: product.get(lastPurchase.get(c.id) ?? '') ?? null, vendedor: c.assigned_to ? labels.get(c.assigned_to) ?? null : null,
    });
  }
  return out;
}
