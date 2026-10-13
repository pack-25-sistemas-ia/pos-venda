import 'server-only';
import type { Context } from '@/lib/auth/session';
import { int, money, type CsvCell } from './csv';
import { toCampaignStats, toSeries } from './dashboard';
import { CUSTOMER_LOAD_LIMIT, currentSegments, labelMap, latestRun, loadPeople, loadSettings, loadSignals, type CustomerRow } from './data';
import { addDays, CHANNEL_LABELS, CONTACT_STATUS_LABELS, OPP_REASON_LABELS, OPP_STATUS_LABELS, rpcArgs, STATE_LABELS, todayIn, type PvFilters } from './filters';
import { bucketLabel } from './format';
import { SEGMENT_LABELS, type SegmentKey } from './rfm';

export type ReportKey =
  | 'clientes-situacao' | 'segmentos-rfm' | 'clientes-em-risco' | 'clientes-inativos' | 'oportunidades' | 'campanhas' | 'contatos-campanhas'
  | 'recompra' | 'receita-periodo' | 'coortes' | 'responsaveis' | 'compras-periodo';

export const REPORTS: Array<{ key: ReportKey; title: string; description: string; scope: string }> = [
  { key: 'clientes-situacao', title: 'Clientes por situação', description: 'Todos os clientes com situação (ativo, em risco, inativo), segmento RFM, pedidos, valor e última compra.', scope: 'Situação de hoje · filtros: responsável, segmento, situação' },
  { key: 'segmentos-rfm', title: 'Segmentos RFM', description: 'Quantos clientes e quanto valor há em cada segmento na rodada RFM mais recente.', scope: 'Última rodada · filtro: responsável' },
  { key: 'clientes-em-risco', title: 'Clientes em risco', description: 'Clientes com sinal de risco (inatividade, ciclo vencido ou queda de frequência), com o motivo.', scope: 'Situação de hoje · filtros: responsável, segmento' },
  { key: 'clientes-inativos', title: 'Clientes inativos', description: 'Clientes sem compra há mais tempo que o limite de inatividade.', scope: 'Situação de hoje · filtros: responsável, segmento' },
  { key: 'oportunidades', title: 'Oportunidades de reativação', description: 'Oportunidades abertas e em andamento, por prioridade, com o motivo, o valor estimado e a próxima ação.', scope: 'Situação de hoje · filtro: responsável' },
  { key: 'campanhas', title: 'Resultado das campanhas', description: 'Público, contatados, respostas e recompras observadas por campanha criada no período.', scope: 'Período · compras observadas após o 1º contato' },
  { key: 'contatos-campanhas', title: 'Contatos de campanhas', description: 'Cada contato manual registrado: data, campanha, cliente, canal e resultado.', scope: 'Período' },
  { key: 'recompra', title: 'Recompra', description: 'Pedidos e receita de clientes que já haviam comprado antes, por período.', scope: 'Período · todos os filtros' },
  { key: 'receita-periodo', title: 'Receita e ticket médio', description: 'Pedidos, receita líquida e ticket médio por período.', scope: 'Período · todos os filtros' },
  { key: 'coortes', title: 'Retenção por coorte', description: 'Por mês da primeira compra, quantos clientes voltaram a comprar nos meses seguintes.', scope: 'Últimos 6 meses · filtro: responsável' },
  { key: 'responsaveis', title: 'Desempenho por responsável', description: 'Carteira, tarefas concluídas, contatos de campanha e reativações observadas por responsável.', scope: 'Período' },
  { key: 'compras-periodo', title: 'Compras do período', description: 'Lista das compras do período com total, estorno, valor líquido e situação.', scope: 'Período · filtro: responsável' },
];
export const REPORT_KEYS = REPORTS.map((r) => r.key);
const MAX_ROWS = 5000;

export type Report = { title: string; headers: string[]; rows: CsvCell[][]; truncated: boolean };

const SIGNAL_LABELS: Record<string, string> = { inactivity: 'Inatividade', cycle: 'Ciclo de recompra vencido', frequency_drop: 'Queda de frequência' };
const dateOnly = (v: string | null | undefined) => (v ? v.slice(0, 10).split('-').reverse().join('/') : '');
const day = (v: string | null | undefined, tz: string) => (v ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: tz }).format(new Date(v)) : '');

/** Mesmos números do painel: a fonte é sempre uma função SQL ou a mesma consulta das telas. */
export async function buildReport(ctx: Context, key: ReportKey, f: PvFilters): Promise<Report> {
  const org = ctx.membership.organization_id;
  const db = ctx.supabase;
  const settings = await loadSettings(ctx);
  const tz = settings.timezone;
  const today = todayIn(tz);
  const title = REPORTS.find((r) => r.key === key)!.title;
  const finish = (headers: string[], rows: CsvCell[][]): Report => ({ title, headers, rows: rows.slice(0, MAX_ROWS), truncated: rows.length > MAX_ROWS });
  const base = rpcArgs(org, f);

  switch (key) {
    case 'clientes-situacao':
    case 'clientes-em-risco':
    case 'clientes-inativos': {
      let q = db.from('customers').select('id, name, company_name, assigned_to').eq('organization_id', org).is('archived_at', null);
      if (f.seller) q = q.eq('assigned_to', f.seller);
      const [{ data }, signals, run, people] = await Promise.all([q.order('name').limit(CUSTOMER_LOAD_LIMIT), loadSignals(ctx, today), latestRun(ctx), loadPeople(ctx)]);
      const segs = await currentSegments(ctx, run);
      const labels = labelMap(people);
      const wantState = key === 'clientes-em-risco' ? 'at_risk' : key === 'clientes-inativos' ? 'inactive' : f.status;
      const rows = ((data ?? []) as Array<Pick<CustomerRow, 'id' | 'name' | 'company_name' | 'assigned_to'>>)
        .map((c) => ({ c, s: signals.get(c.id), g: segs.get(c.id) }))
        .filter(({ s, g }) => (!wantState || s?.state === wantState) && (!f.segment || (g?.segment_key ?? 'sem_compras') === f.segment))
        .map(({ c, s, g }): CsvCell[] => [
          c.name, c.company_name, s ? STATE_LABELS[s.state] : '', g ? SEGMENT_LABELS[g.segment_key as SegmentKey] ?? g.segment_key : '', c.assigned_to ? labels.get(c.assigned_to) ?? '' : '',
          int(s?.n_valid ?? 0), money(s?.net_total_cents ?? 0), dateOnly(s?.last_at), s?.days_since == null ? '' : int(s.days_since), (s?.signals ?? []).map((x) => SIGNAL_LABELS[x] ?? x).join(' + '),
        ]);
      return finish(['Cliente', 'Empresa', 'Situação', 'Segmento RFM', 'Responsável', 'Pedidos válidos', 'Total gasto (R$)', 'Última compra', 'Dias sem comprar', 'Sinais de risco'], rows);
    }
    case 'segmentos-rfm': {
      const { data } = await db.rpc('pv_rfm_distribution', { p_org: org, p_seller: f.seller });
      const list = (data ?? []) as Array<{ segment_key: string; customers: number; monetary_cents: number; reference_date: string | null; model_version: number | null }>;
      const total = list.reduce((a, r) => a + Number(r.customers), 0);
      return finish(['Segmento', 'Clientes', '% dos clientes', 'Valor na janela (R$)', 'Rodada', 'Data de referência'],
        list.map((r) => [SEGMENT_LABELS[r.segment_key as SegmentKey] ?? r.segment_key, int(Number(r.customers)), total === 0 ? '' : (Number(r.customers) / total) * 100, money(Number(r.monetary_cents)), r.model_version == null ? '' : `v${r.model_version}`, dateOnly(r.reference_date)]));
    }
    case 'oportunidades': {
      let q = db.from('reactivation_opportunities').select('id, customer_id, reason, priority, estimated_value_cents, explanation_json, status, assigned_to, next_action, identified_at').eq('organization_id', org).in('status', ['open', 'in_progress']);
      if (f.seller) q = q.eq('assigned_to', f.seller);
      const [{ data }, people] = await Promise.all([q.order('priority', { ascending: false }).limit(MAX_ROWS + 1), loadPeople(ctx)]);
      const opps = (data ?? []) as Array<{ customer_id: string; reason: string; priority: number; estimated_value_cents: number | null; explanation_json: Record<string, unknown>; status: string; assigned_to: string | null; next_action: string | null; identified_at: string }>;
      const ids = [...new Set(opps.map((o) => o.customer_id))];
      const { data: custs } = ids.length ? await db.from('customers').select('id, name').in('id', ids.slice(0, 5000)) : { data: [] };
      const names = new Map(((custs ?? []) as Array<{ id: string; name: string }>).map((c) => [c.id, c.name]));
      const labels = labelMap(people);
      return finish(['Cliente', 'Motivo', 'Prioridade', 'Valor estimado (R$)', 'Dias sem comprar', 'Situação', 'Responsável', 'Próxima ação', 'Identificada em'],
        opps.map((o) => [names.get(o.customer_id) ?? '', OPP_REASON_LABELS[o.reason as keyof typeof OPP_REASON_LABELS] ?? o.reason, int(o.priority), money(o.estimated_value_cents), typeof o.explanation_json.days_since_last === 'number' ? int(o.explanation_json.days_since_last as number) : '',
          OPP_STATUS_LABELS[o.status as keyof typeof OPP_STATUS_LABELS] ?? o.status, o.assigned_to ? labels.get(o.assigned_to) ?? '' : '', o.next_action, day(o.identified_at, tz)]));
    }
    case 'campanhas': {
      const { data } = await db.rpc('pv_campaign_stats', { p_org: org, p_from: f.from, p_to: f.to });
      return finish(['Campanha', 'Situação', 'Canal', 'No público', 'Fora do público', 'Contatados', 'Responderam', '% de resposta', 'Recompraram (observado)', 'Valor observado (R$)', 'Criada em'],
        toCampaignStats(data).map((c) => [c.name, c.status, CHANNEL_LABELS[c.channel as keyof typeof CHANNEL_LABELS] ?? c.channel, int(c.eligible), int(c.excluded), int(c.contacted), int(c.responded), c.response_rate ?? '', int(c.rebought), money(c.rebought_value_cents), day(c.created_at, tz)]));
    }
    case 'contatos-campanhas': {
      const { data } = await db.from('campaign_contacts').select('campaign_id, customer_id, contact_method, contact_status, contacted_by, contacted_at, notes')
        .eq('organization_id', org).neq('contact_status', 'planned').gte('contacted_at', `${f.from}T00:00:00-03:00`).lte('contacted_at', `${addDays(f.to, 1)}T02:59:59Z`).order('contacted_at', { ascending: false }).limit(MAX_ROWS + 1);
      const contacts = (data ?? []) as Array<{ campaign_id: string; customer_id: string; contact_method: string; contact_status: string; contacted_by: string | null; contacted_at: string | null; notes: string | null }>;
      const [{ data: camps }, { data: custs }, people] = await Promise.all([
        db.from('campaigns').select('id, name').eq('organization_id', org),
        contacts.length ? db.from('customers').select('id, name').in('id', [...new Set(contacts.map((c) => c.customer_id))].slice(0, 5000)) : Promise.resolve({ data: [] }),
        loadPeople(ctx),
      ]);
      const cn = new Map(((camps ?? []) as Array<{ id: string; name: string }>).map((c) => [c.id, c.name]));
      const un = new Map(((custs ?? []) as Array<{ id: string; name: string }>).map((c) => [c.id, c.name]));
      const labels = labelMap(people);
      return finish(['Data', 'Campanha', 'Cliente', 'Canal', 'Resultado', 'Registrado por', 'Observações'],
        contacts.map((c) => [day(c.contacted_at, tz), cn.get(c.campaign_id) ?? '', un.get(c.customer_id) ?? '', CHANNEL_LABELS[c.contact_method as keyof typeof CHANNEL_LABELS] ?? c.contact_method, CONTACT_STATUS_LABELS[c.contact_status as keyof typeof CONTACT_STATUS_LABELS] ?? c.contact_status, c.contacted_by ? labels.get(c.contacted_by) ?? '' : '', c.notes]));
    }
    case 'recompra': {
      const { data } = await db.rpc('pv_series', base);
      return finish(['Período', 'Pedidos', 'Pedidos de recompra', '% de recompra', 'Receita de recompra (R$)', 'Receita total (R$)'],
        toSeries(data).map((p) => [bucketLabel(p.bucket, p.granularity), int(p.orders), int(p.repeat_orders), p.orders === 0 ? '' : Math.round((p.repeat_orders / p.orders) * 1000) / 10, money(p.repeat_revenue_cents), money(p.revenue_cents)]));
    }
    case 'receita-periodo': {
      const { data } = await db.rpc('pv_series', base);
      return finish(['Período', 'Pedidos', 'Receita líquida (R$)', 'Ticket médio (R$)', 'Clientes reativados (observado)'],
        toSeries(data).map((p) => [bucketLabel(p.bucket, p.granularity), int(p.orders), money(p.revenue_cents), money(p.avg_ticket_cents), int(p.reactivated)]));
    }
    case 'coortes': {
      const { data } = await db.rpc('pv_cohorts', { p_org: org, p_months: 6, p_seller: f.seller });
      const cells = (data ?? []) as Array<{ cohort_month: string; month_offset: number; customers: number; cohort_size: number }>;
      return finish(['Coorte (mês da 1ª compra)', 'Clientes na coorte', 'Meses depois', 'Clientes que voltaram', '% da coorte'],
        cells.map((c) => [dateOnly(c.cohort_month).slice(3), int(Number(c.cohort_size)), int(Number(c.month_offset)), int(Number(c.customers)), Number(c.cohort_size) === 0 ? '' : Math.round((Number(c.customers) / Number(c.cohort_size)) * 1000) / 10]));
    }
    case 'responsaveis': {
      const [{ data }, people] = await Promise.all([db.rpc('pv_seller_ranking', { p_org: org, p_from: f.from, p_to: f.to }), loadPeople(ctx)]);
      const labels = labelMap(people);
      const list = (data ?? []) as Array<{ seller_id: string | null; customers: number; activities_done: number; contacts: number; reactivated: number; reactivation_revenue_cents: number }>;
      return finish(['Responsável', 'Clientes na carteira', 'Tarefas concluídas', 'Contatos de campanha', 'Clientes reativados (observado)', 'Receita observada (R$)'],
        list.map((r) => [r.seller_id ? labels.get(r.seller_id) ?? 'Usuário' : 'Sem responsável', int(Number(r.customers)), int(Number(r.activities_done)), int(Number(r.contacts)), int(Number(r.reactivated)), money(Number(r.reactivation_revenue_cents))]));
    }
    case 'compras-periodo': {
      let ids: string[] | null = null;
      if (f.seller) {
        const { data } = await db.from('customers').select('id').eq('organization_id', org).eq('assigned_to', f.seller).limit(CUSTOMER_LOAD_LIMIT);
        ids = ((data ?? []) as Array<{ id: string }>).map((c) => c.id);
      }
      let q = db.from('purchases').select('customer_id, external_order_id, purchased_at, total_cents, refunded_cents, net_cents, status, is_valid').eq('organization_id', org)
        .gte('purchased_at', `${f.from}T00:00:00-03:00`).lte('purchased_at', `${addDays(f.to, 1)}T02:59:59Z`);
      if (ids) q = q.in('customer_id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']);
      const { data } = await q.order('purchased_at', { ascending: false }).limit(MAX_ROWS + 1);
      const rows = (data ?? []) as Array<{ customer_id: string; external_order_id: string | null; purchased_at: string; total_cents: number; refunded_cents: number; net_cents: number; status: string; is_valid: boolean }>;
      const { data: custs } = rows.length ? await db.from('customers').select('id, name').in('id', [...new Set(rows.map((r) => r.customer_id))].slice(0, 5000)) : { data: [] };
      const names = new Map(((custs ?? []) as Array<{ id: string; name: string }>).map((c) => [c.id, c.name]));
      return finish(['Data', 'Pedido', 'Cliente', 'Total (R$)', 'Estornado (R$)', 'Líquido (R$)', 'Situação'],
        rows.map((r) => [day(r.purchased_at, tz), r.external_order_id, names.get(r.customer_id) ?? '', money(Number(r.total_cents)), money(Number(r.refunded_cents)), money(Number(r.net_cents)), r.status === 'cancelled' ? 'Cancelada' : r.is_valid ? 'Válida' : 'Estornada']));
    }
  }
}

/** Texto de uma célula para exibir na tela (a mesma formatação do CSV, mas com separadores brasileiros). */
export function cellText(c: CsvCell): string {
  if (c === null || c === undefined) return '';
  if (typeof c === 'object') return 'int' in c ? String(c.int) : c.cents === null ? '' : (c.cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  if (typeof c === 'number') return c.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
  return c;
}
