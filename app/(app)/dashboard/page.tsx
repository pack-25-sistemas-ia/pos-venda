import type { Metadata } from 'next';
import Link from 'next/link';
import { Alert, Badge, Card, PageHeader } from '@/components/ui/primitives';
import { FilterBar } from '@/components/app/filter-bar';
import {
  CampaignChartClient, CohortChartClient, FrequencyChartClient, ReactivationChartClient, RevenueChartClient, SegmentChartClient, SellerChartClient, StateChartClient, TicketChartClient,
} from '@/components/pv/charts-loader';
import { requireContext } from '@/lib/auth/session';
import { isManager, type SearchParams } from '@/lib/pv/access';
import { ALERT_LINKS, ALERT_TITLES, campaignRows, cohortRows, frequencyRows, periodRows, segmentRows, sellerRows, stateRows } from '@/lib/pv/chart-rows';
import { loadDashboard } from '@/lib/pv/dashboard';
import { labelMap, listCategories, loadPeople, loadSettings, personOptions } from '@/lib/pv/data';
import { filtersToQuery, parseFilters, todayIn } from '@/lib/pv/filters';
import { formatBRL, formatDate, formatInt, formatPct, variationPct } from '@/lib/pv/format';

export const metadata: Metadata = { title: 'Painel' };

function Kpi({ label, value, hint, help, trend, muted }: { label: string; value: string; hint: string; help: string; trend?: string | null; muted?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-sm" title={help}>
      <p className="text-sm text-muted">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${muted ? 'text-muted' : ''}`}>{value}</p>
      <p className="mt-2 text-xs text-muted">{hint}</p>
      {trend ? <p className="mt-1 text-xs font-medium">{trend}</p> : null}
    </div>
  );
}

/** Variação em texto ("▲ +12,5% vs período anterior"): não depende só de cor. */
function trendText(v: number | null, suffix = '%'): string | null {
  if (v === null) return null;
  const arrow = v > 0 ? '▲' : v < 0 ? '▼' : '■';
  return `${arrow} ${v > 0 ? '+' : ''}${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}${suffix} vs período anterior`;
}
const pp = (a: number | null | undefined, b: number | null | undefined) => (a == null || b == null ? null : Math.round((a - b) * 10) / 10);

export default async function DashboardPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireContext();
  const sp = await searchParams;
  const settings = await loadSettings(ctx);
  const filters = parseFilters(sp, todayIn(settings.timezone));
  const manager = isManager(ctx.membership.role);
  const [people, categories, data] = await Promise.all([loadPeople(ctx), listCategories(ctx), loadDashboard(ctx, filters)]);
  const labels = labelMap(people);
  const query = filtersToQuery(filters);

  if (data.error || !data.kpis) {
    return (
      <>
        <PageHeader title="Painel" />
        <Alert tone="error">Não foi possível carregar os indicadores agora. Tente novamente em instantes.</Alert>
      </>
    );
  }

  const k = data.kpis;
  const p = data.previous;
  const empty = k.orders === 0 && data.states.every((s) => s.customers === 0);
  const alerts = data.alerts.filter((a) => a.customers > 0);
  const lowSample = data.segments.some((s) => s.low_sample);

  return (
    <>
      <PageHeader title="Painel" description={`Período: ${formatDate(filters.from)} a ${formatDate(filters.to)} (fuso ${settings.timezone}). Números calculados do banco de dados; fórmulas em docs/METRICS.md.`}>
        <Link className="inline-flex min-h-10 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/5" href={`/relatorios?${query}`}>Relatórios</Link>
      </PageHeader>

      <FilterBar action="/dashboard" filters={filters} sellers={manager ? personOptions(people) : undefined} categories={categories} />
      {!manager ? <div className="mb-4"><Alert tone="info">Você vê os números dos clientes atribuídos a você.</Alert></div> : null}
      {empty ? <div className="mb-4"><Alert tone="info">Ainda não há clientes ou compras neste período. Importe uma lista em «Clientes» e «Compras», ou amplie o período.</Alert></div> : null}
      {lowSample ? <div className="mb-4"><Alert tone="warning">Poucos clientes pontuados na última rodada RFM (menos de 5): as notas e os segmentos são apenas indicativos.</Alert></div> : null}

      <section aria-label="Indicadores" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Kpi label="Clientes que compraram" value={formatInt(k.recent_customers)} hint="Com ao menos uma compra válida no período." help="Clientes distintos com compra concluída (e valor líquido maior que zero) dentro do período." trend={trendText(variationPct(k.recent_customers, p?.recent_customers ?? null))} />
        <Kpi label="Clientes em risco" value={formatInt(k.at_risk)} hint="Situação atual, pelas regras de risco." help="Clientes com algum sinal de risco (inatividade, ciclo de recompra vencido ou queda de frequência) que ainda não chegaram ao limite de inatividade. Situação de agora, não depende do período." />
        <Kpi label="Clientes inativos" value={formatInt(k.inactive)} hint="Sem compra além do limite de inatividade." help="Clientes cujo tempo sem comprar atingiu o limite de inatividade configurado. Situação de agora." />
        <Kpi label="Clientes reativados (observado)" value={formatInt(k.reactivated)} hint="Compraram depois de identificados em risco." help="Clientes com oportunidade de reativação que fizeram uma nova compra válida no período. É uma observação (aconteceu depois), não uma prova de que a ação causou a compra." trend={trendText(variationPct(k.reactivated, p?.reactivated ?? null))} />
        <Kpi label="Taxa de reativação (observada)" value={formatPct(k.reactivation_rate)} hint={k.reactivation_rate === null ? 'Sem oportunidades com a janela encerrada' : `${k.reactivation_cohort_done} de ${k.reactivation_cohort} cliente(s), janela de ${settings.observation_days} dias`} help="Entre os clientes cujas oportunidades foram identificadas no período e cuja janela de observação já terminou, quantos % recompraram dentro da janela. Janelas ainda abertas ficam de fora para não subestimar." muted={k.reactivation_rate === null} trend={trendText(pp(k.reactivation_rate, p?.reactivation_rate), ' p.p.')} />
        <Kpi label="Receita de clientes reativados (observada)" value={formatBRL(k.reactivation_revenue_cents)} hint="Compras que reativaram clientes no período." help="Valor líquido das compras que reconheceram a reativação. Valor observado após a identificação; não é receita incremental." trend={trendText(variationPct(k.reactivation_revenue_cents, p?.reactivation_revenue_cents ?? null))} />
        <Kpi label="Taxa de recompra" value={formatPct(k.repurchase_rate)} hint={k.repurchase_rate === null ? 'Sem compras no período' : `${k.repurchase_repeat} de ${k.repurchase_buyers} compradores com 2 ou mais pedidos`} help="Dos clientes que compraram no período, quantos % fizeram dois ou mais pedidos válidos no mesmo período." muted={k.repurchase_rate === null} trend={trendText(pp(k.repurchase_rate, p?.repurchase_rate), ' p.p.')} />
        <Kpi label="Receita no período" value={formatBRL(k.revenue_cents)} hint={`${formatInt(k.orders)} pedido(s) válido(s).`} help="Soma do valor líquido (total menos estornos) das compras concluídas no período. Cancelamentos e estornos totais não entram." trend={trendText(variationPct(k.revenue_cents, p?.revenue_cents ?? null))} />
        <Kpi label="Ticket médio" value={formatBRL(k.avg_ticket_cents)} hint={k.avg_ticket_cents === null ? 'Sem pedidos no período' : 'Receita ÷ pedidos válidos.'} help="Valor líquido médio por pedido válido no período." muted={k.avg_ticket_cents === null} trend={trendText(variationPct(k.avg_ticket_cents, p?.avg_ticket_cents ?? null))} />
        <Kpi label="Tarefas vencidas" value={formatInt(k.overdue_tasks)} hint="Tarefas de clientes vencidas e não concluídas (agora)." help="Tarefas com prazo vencido e não concluídas dos clientes que você enxerga." />
      </section>

      <section aria-label="Gráficos" className="mt-6 grid gap-4 lg:grid-cols-2">
        <RevenueChartClient rows={periodRows(data.series)} />
        <TicketChartClient rows={periodRows(data.series)} />
        <SegmentChartClient rows={segmentRows(data.segments)} />
        <StateChartClient rows={stateRows(data.states)} />
        <FrequencyChartClient rows={frequencyRows(data.frequency)} />
        <ReactivationChartClient rows={periodRows(data.series)} />
        <CohortChartClient rows={cohortRows(data.cohorts)} />
        <CampaignChartClient rows={campaignRows(data.campaigns)} />
        <SellerChartClient rows={sellerRows(data.sellers, labels)} />
      </section>

      <section aria-label="Alertas" className="mt-6">
        <Card title="Alertas" description="Situação de agora, para a sua carteira.">
          {alerts.length === 0 ? <p className="text-sm text-muted">Nenhum alerta no momento. Tudo em dia.</p> : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {alerts.map((a) => (
                <li key={a.key} className="flex items-center justify-between gap-3 rounded-md border border-border p-3 text-sm">
                  <Link className="font-medium underline-offset-2 hover:underline" href={ALERT_LINKS[a.key]}>{ALERT_TITLES[a.key]}</Link>
                  <Badge tone={a.key === 'overdue_tasks' || a.key === 'high_priority_open' ? 'danger' : 'warning'}>{a.customers}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>
    </>
  );
}
