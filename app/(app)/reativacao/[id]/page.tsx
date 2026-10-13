import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card, PageHeader } from '@/components/ui/primitives';
import { OppStatusBadge, PriorityBadge, SegmentBadge, StateBadge, reasonLabel } from '@/components/pv/badges';
import { ActivityForm } from '@/components/pv/customer-forms';
import { ActivityList } from '@/components/pv/detail-bits';
import { OpportunityControls } from '@/components/pv/opportunity-actions';
import { requireContext } from '@/lib/auth/session';
import { nowIso } from '@/lib/time';
import { canWrite, isManager } from '@/lib/pv/access';
import { labelMap, loadOpportunity, loadPeople, loadSettings, personOptions } from '@/lib/pv/data';
import { formatBRL, formatDate, formatDateTime, formatDays } from '@/lib/pv/format';

export const metadata: Metadata = { title: 'Oportunidade de reativação' };

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export default async function OpportunityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const ctx = await requireContext();
  const detail = await loadOpportunity(ctx, id);
  if (!detail) notFound();
  const { opp, customer, signal, segment, activities } = detail;
  const [settings, people] = await Promise.all([loadSettings(ctx), loadPeople(ctx)]);
  const labels = labelMap(people);
  const e = opp.explanation_json;
  const refDays = num(e.reference_days);
  const days = num(e.days_since_last);
  const overdueRatio = refDays && days !== null ? Math.min(1, days / Math.max(refDays, 1)) : null;
  const pm = num(e.value_percentile);
  const pf = num(e.frequency_percentile);
  const wSum = settings.w_value + settings.w_frequency + settings.w_overdue;
  const now = Date.parse(nowIso());
  const writable = canWrite(ctx.membership.role);

  return (
    <>
      <PageHeader title={customer?.name ?? 'Cliente'} description={`Oportunidade: ${reasonLabel(opp.reason)}`}>
        {customer ? <Link className="inline-flex min-h-10 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/5" href={`/clientes/${customer.id}`}>Abrir ficha do cliente</Link> : null}
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Por que este cliente está aqui?" description="Explicação gerada pelas regras configuradas. Nenhuma decisão automática sobre a pessoa.">
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <PriorityBadge priority={opp.priority} high={settings.priority_high} medium={settings.priority_medium} />
              <OppStatusBadge status={opp.status} />
              <StateBadge state={signal?.state} />
              <SegmentBadge segment={segment?.segment_key} />
            </div>
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {opp.reason === 'inactivity' ? <li>Está há <strong>{days !== null ? formatDays(days) : '—'}</strong> sem comprar (limite de risco: {settings.risk_days} dias; de inatividade: {settings.inactive_days} dias).</li> : null}
              {opp.reason === 'cycle' ? <li>Costuma comprar a cada <strong>{num(e.median_interval_days) !== null ? formatDays(Math.round(num(e.median_interval_days) as number)) : '—'}</strong> (mediana de {num(e.purchases) ?? '—'} compras) e já passou de {settings.cycle_factor.toLocaleString('pt-BR')}× esse intervalo: {days !== null ? formatDays(days) : '—'} sem comprar.</li> : null}
              {opp.reason === 'frequency_drop' ? <li>Fez <strong>{num(e.orders_recent) ?? '—'}</strong> pedido(s) nos últimos {settings.drop_window_days} dias contra <strong>{num(e.orders_previous) ?? '—'}</strong> nos {settings.drop_window_days} dias anteriores (queda mínima configurada: {settings.drop_pct}%).</li> : null}
              {opp.reason === 'segment_change' ? <li>Mudou de segmento RFM: <strong>{String(e.from_segment ?? '—')}</strong> → <strong>{String(e.to_segment ?? '—')}</strong> entre duas rodadas.</li> : null}
              <li>Última compra: {formatDate(typeof e.last_purchase === 'string' ? e.last_purchase : signal?.last_at)} · {num(e.purchases) ?? signal?.n_valid ?? 0} compra(s) válida(s).</li>
              <li>Valor estimado: {opp.estimated_value_cents === null ? 'não calculado (exige 3 ou mais compras)' : <><strong>{formatBRL(opp.estimated_value_cents)}</strong> — ticket mediano histórico, uma <em>referência</em>, não uma previsão</>}.</li>
            </ul>
          </Card>

          <Card title="Como a prioridade foi calculada" description="Média ponderada de três componentes de 0 a 100, com os pesos das configurações.">
            {pm !== null && pf !== null && overdueRatio !== null && wSum > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[28rem] text-left text-sm">
                  <caption className="sr-only">Componentes da prioridade</caption>
                  <thead className="border-b border-border text-muted"><tr><th className="py-2 pr-4 font-medium">Componente</th><th className="py-2 pr-4 font-medium">Valor (0–100)</th><th className="py-2 pr-4 font-medium">Peso</th><th className="py-2 font-medium">Contribuição</th></tr></thead>
                  <tbody>
                    {[
                      ['Valor histórico (posição entre os clientes)', pm, settings.w_value],
                      ['Frequência (posição entre os clientes)', pf, settings.w_frequency],
                      ['Atraso em relação ao esperado', Math.round(overdueRatio * 100), settings.w_overdue],
                    ].map(([label, value, w]) => (
                      <tr key={String(label)} className="border-b border-border last:border-0"><td className="py-2 pr-4">{label}</td><td className="py-2 pr-4 tabular-nums">{value}</td><td className="py-2 pr-4 tabular-nums">{w}%</td><td className="py-2 tabular-nums">{(((value as number) * (w as number)) / wSum).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}</td></tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-2 text-xs text-muted">Prioridade = soma das contribuições, arredondada ({opp.priority}). Os pesos de hoje podem ser diferentes dos da época em que a oportunidade foi calculada.</p>
              </div>
            ) : <p className="text-sm text-muted">Os componentes desta oportunidade não foram guardados (ela vem de uma regra de mudança de segmento ou de uma análise antiga). A prioridade registrada é {opp.priority}.</p>}
          </Card>

          <Card title="Tarefas desta oportunidade">
            {writable && customer && !customer.archived_at && !customer.anonymized_at ? <div className="mb-6"><ActivityForm customerId={customer.id} people={personOptions(people)} opportunityId={opp.id} /></div> : null}
            <ActivityList activities={activities} customerId={opp.customer_id} canWrite={writable} labels={labels} timezone={settings.timezone} now={now} />
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Andamento">
            <dl className="space-y-2 text-sm">
              <div><dt className="text-xs text-muted">Identificada em</dt><dd>{formatDateTime(opp.identified_at, settings.timezone)}</dd></div>
              <div><dt className="text-xs text-muted">Último contato</dt><dd>{formatDateTime(opp.last_contact_at, settings.timezone)}</dd></div>
              <div><dt className="text-xs text-muted">Responsável</dt><dd>{opp.assigned_to ? labels.get(opp.assigned_to) ?? 'Usuário' : <span className="text-warning">Sem responsável</span>}</dd></div>
              {opp.resolved_at ? <div><dt className="text-xs text-muted">{opp.status === 'reactivated' ? 'Reativada em (compra observada)' : 'Encerrada em'}</dt><dd>{formatDateTime(opp.resolved_at, settings.timezone)}</dd></div> : null}
              {opp.discard_reason ? <div><dt className="text-xs text-muted">Motivo do descarte</dt><dd>{opp.discard_reason}</dd></div> : null}
            </dl>
          </Card>
          <Card title="Ações">
            <OpportunityControls id={opp.id} status={opp.status} nextAction={opp.next_action} assignedTo={opp.assigned_to} people={personOptions(people)} canManage={isManager(ctx.membership.role)} canWrite={writable} />
          </Card>
        </div>
      </div>
    </>
  );
}
