import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Alert, Card, PageHeader } from '@/components/ui/primitives';
import { CampaignStatusBadge } from '@/components/pv/badges';
import { CampaignControls, CampaignForm, MembersPanel } from '@/components/pv/campaign-forms';
import { requireContext } from '@/lib/auth/session';
import { canWrite, isManager } from '@/lib/pv/access';
import { labelMap, listSegmentDefs, listTemplates, loadCampaign, loadMemberVars, loadPeople, loadSettings, personOptions } from '@/lib/pv/data';
import { CHANNEL_LABELS, todayIn } from '@/lib/pv/filters';
import { formatBRL, formatDateTime, formatInt, formatPct } from '@/lib/pv/format';
import { describeCriteria } from '@/lib/pv/segments';

export const metadata: Metadata = { title: 'Campanha' };

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const ctx = await requireContext();
  const detail = await loadCampaign(ctx, id);
  if (!detail) notFound();
  const manager = isManager(ctx.membership.role);
  const [settings, people, segments, templates] = await Promise.all([loadSettings(ctx), loadPeople(ctx), listSegmentDefs(ctx), manager ? listTemplates(ctx) : Promise.resolve([])]);
  const labels = labelMap(people);
  const { campaign: c, memberships, contacts, outcomes } = detail;
  const vars = await loadMemberVars(ctx, memberships.filter((m) => m.status !== 'excluded').map((m) => m.customer_id), labels, todayIn(settings.timezone));

  const inAudience = memberships.filter((m) => m.status !== 'excluded');
  const contactedIds = new Set(contacts.filter((k) => k.contact_status !== 'planned').map((k) => k.customer_id));
  const respondedIds = new Set(contacts.filter((k) => k.contact_status === 'responded').map((k) => k.customer_id));
  const rebought = new Set(outcomes.map((o) => o.customer_id));
  const observedCents = outcomes.reduce((a, o) => a + o.net_cents, 0);
  const rate = contactedIds.size === 0 ? null : Math.round((respondedIds.size / contactedIds.size) * 1000) / 10;
  const editable = manager && (c.status === 'draft' || c.status === 'planned');
  const running = c.status === 'running';
  const segment = detail.segment;
  const rows = memberships.map((m) => ({
    id: m.id, customer_id: m.customer_id, customer_name: m.customer_name, status: m.status, exclusion_reason: m.exclusion_reason,
    contacts: contacts.filter((k) => k.customer_id === m.customer_id).map((k) => ({ id: k.id, contact_status: k.contact_status, contacted_at: k.contacted_at, notes: k.notes })),
    vars: vars.get(m.customer_id) ?? {},
  }));

  return (
    <>
      <PageHeader title={c.name} description={c.objective ?? undefined}>
        <div className="flex flex-col items-end gap-2">
          <CampaignStatusBadge status={c.status} />
          {manager ? <CampaignControls id={c.id} status={c.status} hasSegment={Boolean(c.segment_id)} /> : null}
        </div>
      </PageHeader>

      {c.status === 'running' || c.status === 'paused' || c.status === 'completed' ? (
        <div className="mb-4"><Alert tone="info">Resultados <strong>observados</strong>: compras válidas depois do primeiro contato registrado, em até {c.observation_days} dias. Não afirmam que a campanha causou a compra: o cliente pode ter comprado de qualquer forma.</Alert></div>
      ) : null}

      <section aria-label="Resultados" className="mb-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {[
          ['No público', formatInt(inAudience.length), `${memberships.length - inAudience.length} fora do público`],
          ['Contatados', formatInt(contactedIds.size), 'Com ao menos um contato registrado'],
          ['Responderam', formatInt(respondedIds.size), rate === null ? 'Sem contatos' : `${formatPct(rate)} dos contatados`],
          ['Recompraram (observado)', formatInt(rebought.size), 'Compra depois do 1º contato'],
          ['Valor observado', formatBRL(observedCents), 'Valor líquido das compras'],
          ['Tarefas pendentes', formatInt(detail.activities.filter((a) => !a.completed_at).length), 'Ligadas a esta campanha'],
        ].map(([label, value, hint]) => (
          <div key={label} className="rounded-lg border border-border bg-card p-3"><p className="text-xs text-muted">{label}</p><p className="mt-1 text-xl font-semibold tabular-nums">{value}</p><p className="mt-1 text-xs text-muted">{hint}</p></div>
        ))}
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Público e contatos" description={running ? 'Registre cada contato feito. «Copiar mensagem» preenche o modelo com os dados do cliente.' : memberships.length === 0 ? undefined : 'O público fica congelado quando a campanha é iniciada.'}>
            {memberships.length === 0 ? (
              <p className="text-sm text-muted">{c.segment_id ? (manager ? 'Clique em «Calcular público» para ver quem é elegível.' : 'O público ainda não foi calculado.') : 'Escolha um segmento em «Editar campanha» para calcular o público.'}</p>
            ) : (
              <MembersPanel campaignId={c.id} rows={rows} body={c.message_body ?? ''} subject={c.message_subject} running={running} canWrite={canWrite(ctx.membership.role)} channel={c.channel} />
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Resumo">
            <dl className="space-y-2 text-sm">
              <div><dt className="text-xs text-muted">Canal (contato manual)</dt><dd>{CHANNEL_LABELS[c.channel]}</dd></div>
              <div><dt className="text-xs text-muted">Segmento</dt><dd>{segment ? <Link className="underline" href={`/segmentacao/segmentos/${segment.id}`}>{segment.name}</Link> : '—'}</dd>{segment ? <dd className="text-xs text-muted">{describeCriteria(segment.criteria_json)}</dd> : null}</div>
              <div><dt className="text-xs text-muted">Responsável</dt><dd>{c.owner_id ? labels.get(c.owner_id) ?? 'Usuário' : '—'}</dd></div>
              <div><dt className="text-xs text-muted">Janela de observação</dt><dd>{c.observation_days} dias</dd></div>
              <div><dt className="text-xs text-muted">Iniciada em</dt><dd>{formatDateTime(c.started_at, settings.timezone)}</dd></div>
              <div><dt className="text-xs text-muted">Concluída em</dt><dd>{formatDateTime(c.completed_at, settings.timezone)}</dd></div>
            </dl>
          </Card>
          {c.message_body ? <Card title="Mensagem de apoio"><p className="whitespace-pre-wrap break-words text-sm">{c.message_body}</p></Card> : null}
          {editable ? (
            <Card title="Editar campanha">
              <CampaignForm
                id={c.id} segments={segments.filter((s) => s.active).map((s) => ({ value: s.id, label: s.name }))} people={personOptions(people)}
                templates={templates.filter((t) => t.active).map((t) => ({ id: t.id, name: t.name, channel: t.channel, subject: t.subject, body: t.body }))}
                initial={{ name: c.name, description: c.description ?? '', objective: c.objective ?? '', channel: c.channel, segment_id: c.segment_id ?? '', owner_id: c.owner_id ?? '', message_subject: c.message_subject ?? '', message_body: c.message_body ?? '', observation_days: String(c.observation_days) }}
              />
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
