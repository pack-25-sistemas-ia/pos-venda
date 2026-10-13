import type { Metadata } from 'next';
import Link from 'next/link';
import { Alert, Badge, Card, EmptyState, PageHeader } from '@/components/ui/primitives';
import { DeleteSegmentButton, RefreshSegmentButton, RunRfmButton } from '@/components/pv/segment-actions';
import { SegmentBadge } from '@/components/pv/badges';
import { requireContext } from '@/lib/auth/session';
import { isManager } from '@/lib/pv/access';
import { labelMap, latestRun, listRuns, listSegmentDefs, loadPeople, loadSettings } from '@/lib/pv/data';
import { formatBRL, formatDate, formatDateTime, formatInt } from '@/lib/pv/format';
import { SEGMENT_HINTS, SEGMENTS } from '@/lib/pv/rfm';
import { describeCriteria } from '@/lib/pv/segments';

export const metadata: Metadata = { title: 'Segmentação (RFM)' };

export default async function SegmentationPage() {
  const ctx = await requireContext();
  const manager = isManager(ctx.membership.role);
  const [settings, run, runs, defs, people] = await Promise.all([loadSettings(ctx), latestRun(ctx), listRuns(ctx), listSegmentDefs(ctx), loadPeople(ctx)]);
  const labels = labelMap(people);
  const { data: dist } = await ctx.supabase.rpc('pv_rfm_distribution', { p_org: ctx.membership.organization_id });
  const rows = new Map(((dist ?? []) as Array<{ segment_key: string; customers: number; monetary_cents: number }>).map((r) => [r.segment_key, r]));
  const total = [...rows.values()].reduce((a, r) => a + Number(r.customers), 0);

  return (
    <>
      <PageHeader title="Segmentação (RFM)" description="Recência, frequência e valor de cada cliente, em notas de 1 a 5, e os segmentos que resultam delas. Regras transparentes: nada de caixa-preta.">
        {manager ? <RunRfmButton /> : null}
      </PageHeader>

      {!run ? (
        <EmptyState title="Ainda não há rodada RFM" description={manager ? 'Importe clientes e compras e calcule a primeira rodada.' : 'Peça a um gestor para calcular a primeira rodada.'} />
      ) : (
        <>
          <div className="mb-4 grid gap-3 text-sm sm:grid-cols-4">
            <div className="rounded-lg border border-border bg-card p-3"><p className="text-xs text-muted">Rodada</p><p className="text-lg font-semibold">v{run.model_version}</p><p className="text-xs text-muted">Calculada em {formatDateTime(run.created_at, settings.timezone)}</p></div>
            <div className="rounded-lg border border-border bg-card p-3"><p className="text-xs text-muted">Data de referência</p><p className="text-lg font-semibold">{formatDate(run.reference_date)}</p></div>
            <div className="rounded-lg border border-border bg-card p-3"><p className="text-xs text-muted">Janela / método</p><p className="text-lg font-semibold">{run.window_days} dias</p><p className="text-xs text-muted">{run.mode === 'fixed' ? 'Limites fixos' : 'Percentis'}</p></div>
            <div className="rounded-lg border border-border bg-card p-3"><p className="text-xs text-muted">Clientes pontuados</p><p className="text-lg font-semibold">{formatInt(run.scored_count)}</p><p className="text-xs text-muted">Compraram na janela</p></div>
          </div>
          {run.low_sample ? <div className="mb-4"><Alert tone="warning">Amostra pequena: só {run.scored_count} cliente(s) pontuado(s). Com menos de 5, as notas por percentil são apenas indicativas.</Alert></div> : null}

          <Card title="Clientes por segmento" description="Segmento na rodada mais recente. O histórico das rodadas anteriores é preservado.">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[34rem] text-left text-sm">
                <caption className="sr-only">Clientes por segmento RFM</caption>
                <thead className="border-b border-border text-muted"><tr><th className="py-2 pr-4 font-medium">Segmento</th><th className="py-2 pr-4 font-medium">Como entra</th><th className="py-2 pr-4 font-medium">Clientes</th><th className="py-2 pr-4 font-medium">%</th><th className="py-2 font-medium">Valor na janela</th></tr></thead>
                <tbody>
                  {SEGMENTS.map((s) => {
                    const r = rows.get(s);
                    const n = Number(r?.customers ?? 0);
                    return (
                      <tr key={s} className="border-b border-border last:border-0">
                        <td className="py-2 pr-4"><SegmentBadge segment={s} /></td>
                        <td className="py-2 pr-4 text-xs text-muted">{SEGMENT_HINTS[s]}</td>
                        <td className="py-2 pr-4 tabular-nums"><Link className="underline-offset-2 hover:underline" href={`/clientes?segment=${s}`}>{n}</Link></td>
                        <td className="py-2 pr-4 tabular-nums">{total === 0 ? '—' : `${Math.round((n / total) * 1000) / 10}%`.replace('.', ',')}</td>
                        <td className="py-2 tabular-nums">{formatBRL(Number(r?.monetary_cents ?? 0))}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Como o RFM é calculado" description="Resumo; a especificação completa está em docs/RFM_MODEL.md.">
          <ul className="list-disc space-y-1 pl-5 text-sm">
            <li><strong>Recência</strong>: dias desde a última compra válida. <strong>Frequência</strong>: pedidos válidos na janela de {settings.rfm_window_days} dias. <strong>Valor</strong>: soma líquida (sem estornos) na janela.</li>
            <li>Compra válida = concluída e com valor líquido maior que zero. Cancelamentos e estornos totais não entram.</li>
            <li>Modo atual: <strong>{settings.rfm_mode === 'fixed' ? 'limites fixos' : 'percentis'}</strong>. Cada nota vai de 1 a 5; na recência, menos dias valem mais.</li>
            <li>Campeões: R, F e M ≥ 4. Fiéis: R e F ≥ 3. Novos: uma só compra e recente. Promissores: R ≥ 4. Em risco: R ≤ 2 com F ou M ≥ 3. Demais: precisam de atenção.</li>
            <li>Sem compra na janela: <em>inativos</em> (já compraram antes) ou <em>sem compras</em>.</li>
          </ul>
          <p className="mt-3 text-xs text-muted">Janela, método, limites e dias de «novo cliente» são ajustados em Configurações comerciais (administradores).</p>
        </Card>

        <Card title="Rodadas anteriores" description="Cada cálculo gera uma nova versão; nenhuma é sobrescrita.">
          {runs.length === 0 ? <p className="text-sm text-muted">Nenhuma rodada ainda.</p> : (
            <ul className="divide-y divide-border text-sm">
              {runs.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>v{r.model_version} · {formatDate(r.reference_date)} · janela {r.window_days} dias</span>
                  <span className="flex items-center gap-2 text-xs text-muted">{r.scored_count} pontuados{r.low_sample ? <Badge tone="warning">amostra pequena</Badge> : null}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <section className="mt-4" aria-label="Segmentos personalizados">
        <Card title="Segmentos personalizados" description="Combine condições da lista (dias sem comprar, valor, segmento RFM, categoria…). Sem SQL: tudo é validado.">
          {manager ? <div className="mb-4"><Link className="inline-flex min-h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90" href="/segmentacao/segmentos/novo">Novo segmento</Link></div> : null}
          {defs.length === 0 ? <p className="text-sm text-muted">Nenhum segmento ainda.</p> : (
            <ul className="divide-y divide-border">
              {defs.map((d) => (
                <li key={d.id} className="flex flex-wrap items-start justify-between gap-3 py-3 text-sm">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2"><Link className="font-medium underline-offset-2 hover:underline" href={`/segmentacao/segmentos/${d.id}`}>{d.name}</Link>{d.segment_type === 'system' ? <Badge tone="neutral">Sistema</Badge> : null}</div>
                    <p className="mt-1 text-xs text-muted">{describeCriteria(d.criteria_json, labels.size ? new Map([...labels]) : undefined)}</p>
                    <p className="mt-1 text-xs text-muted">{d.members} cliente(s) na última atualização ({formatDateTime(d.updated_at, settings.timezone)}).</p>
                  </div>
                  {manager ? <div className="flex gap-2"><RefreshSegmentButton id={d.id} />{d.segment_type === 'custom' ? <DeleteSegmentButton id={d.id} /> : null}</div> : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>
    </>
  );
}
