import type { Metadata } from 'next';
import Link from 'next/link';
import { Alert, Card, EmptyState, PageHeader } from '@/components/ui/primitives';
import { BulkPreferenceForm } from '@/components/pv/campaign-forms';
import { CampaignStatusBadge } from '@/components/pv/badges';
import { requireContext } from '@/lib/auth/session';
import { isManager } from '@/lib/pv/access';
import { listCampaigns, listSegmentDefs, loadSettings } from '@/lib/pv/data';
import { addDays, CHANNEL_LABELS, todayIn } from '@/lib/pv/filters';
import { formatBRL, formatDay, formatInt, formatPct } from '@/lib/pv/format';
import { toCampaignStats } from '@/lib/pv/dashboard';

export const metadata: Metadata = { title: 'Campanhas' };

export default async function CampaignsPage() {
  const ctx = await requireContext();
  const manager = isManager(ctx.membership.role);
  const settings = await loadSettings(ctx);
  const today = todayIn(settings.timezone);
  const [campaigns, segments, stats] = await Promise.all([
    listCampaigns(ctx), listSegmentDefs(ctx),
    ctx.supabase.rpc('pv_campaign_stats', { p_org: ctx.membership.organization_id, p_from: addDays(today, -1090), p_to: today }),
  ]);
  const byId = new Map(toCampaignStats(stats.data).map((s) => [s.campaign_id, s]));
  const segName = new Map(segments.map((s) => [s.id, s.name]));
  const linkBtn = 'inline-flex min-h-10 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/5';

  return (
    <>
      <PageHeader title="Campanhas de reativação" description="Contato manual com clientes que pedem atenção. O sistema organiza o público e registra o resultado; quem envia a mensagem é a sua equipe.">
        <div className="flex flex-wrap gap-2">
          <Link className={linkBtn} href="/campanhas/modelos">Modelos de mensagem</Link>
          {manager ? <Link className="inline-flex min-h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90" href="/campanhas/nova">Nova campanha</Link> : null}
        </div>
      </PageHeader>
      <div className="mb-4"><Alert tone="info">Só entram em uma campanha clientes com permissão de contato registrada no canal (consentimento ou legítimo interesse) e fora da lista de supressão. Resultados são <strong>observados</strong>: compras depois do primeiro contato, dentro da janela da campanha. Não afirmam que a campanha causou a compra.</Alert></div>

      {campaigns.length === 0 ? (
        <EmptyState title="Nenhuma campanha ainda" description={manager ? 'Crie um segmento de clientes em risco e monte a primeira campanha.' : 'Quando houver campanhas, elas aparecem aqui.'}>
          {manager ? <Link className="underline" href="/segmentacao">Ver segmentos</Link> : null}
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full min-w-[46rem] text-left text-sm">
            <caption className="sr-only">Campanhas</caption>
            <thead className="border-b border-border text-muted"><tr>{['Campanha', 'Situação', 'Canal', 'Público', 'Contatados', 'Responderam', 'Recompraram (observado)', 'Valor observado', 'Criada em'].map((h) => <th key={h} scope="col" className="px-4 py-3 font-medium">{h}</th>)}</tr></thead>
            <tbody>
              {campaigns.map((c) => {
                const s = byId.get(c.id);
                return (
                  <tr key={c.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3"><Link className="font-medium underline-offset-2 hover:underline" href={`/campanhas/${c.id}`}>{c.name}</Link><div className="text-xs text-muted">{c.segment_id ? segName.get(c.segment_id) ?? 'Segmento removido' : 'Sem segmento'}</div></td>
                    <td className="px-4 py-3"><CampaignStatusBadge status={c.status} /></td>
                    <td className="px-4 py-3 text-xs">{CHANNEL_LABELS[c.channel]}</td>
                    <td className="px-4 py-3 tabular-nums">{formatInt(s?.eligible ?? 0)}{s && s.excluded ? <span className="text-xs text-muted"> (+{s.excluded} fora)</span> : null}</td>
                    <td className="px-4 py-3 tabular-nums">{formatInt(s?.contacted ?? 0)}</td>
                    <td className="px-4 py-3 tabular-nums">{formatInt(s?.responded ?? 0)} <span className="text-xs text-muted">{s?.response_rate == null ? '' : `(${formatPct(s.response_rate)})`}</span></td>
                    <td className="px-4 py-3 tabular-nums">{formatInt(s?.rebought ?? 0)}</td>
                    <td className="px-4 py-3 tabular-nums">{formatBRL(s?.rebought_value_cents ?? 0)}</td>
                    <td className="px-4 py-3 text-muted">{formatDay(c.created_at, settings.timezone)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {manager ? (
        <section className="mt-6" aria-label="Permissão de contato em lote">
          <Card title="Registrar permissão de contato em lote" description="Para bases que já têm base legal definida pela empresa. Sem esse registro, ninguém entra em campanhas.">
            <BulkPreferenceForm />
          </Card>
        </section>
      ) : null}
    </>
  );
}
