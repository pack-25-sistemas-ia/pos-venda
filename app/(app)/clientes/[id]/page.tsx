import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Alert, Badge, Card, PageHeader } from '@/components/ui/primitives';
import { SegmentBadge, StateBadge } from '@/components/pv/badges';
import { ActivityForm, AssignControl, CustomerForm, CustomerHeaderActions, PreferenceForm, SuppressionForm } from '@/components/pv/customer-forms';
import { ActivityList, ContactPanel, CustomerCampaigns, EventTimeline, OpportunityMini, PurchaseList } from '@/components/pv/detail-bits';
import { requireContext } from '@/lib/auth/session';
import { nowIso } from '@/lib/time';
import { canWrite, isAdmin, isManager } from '@/lib/pv/access';
import { labelMap, loadCustomer, loadPeople, loadSettings, personOptions } from '@/lib/pv/data';
import { todayIn } from '@/lib/pv/filters';
import { formatBRL, formatDate, formatDateTime, formatDays, formatDocument, formatPhone } from '@/lib/pv/format';
import { SEGMENT_HINTS, SEGMENT_LABELS, type SegmentKey } from '@/lib/pv/rfm';

export const metadata: Metadata = { title: 'Cliente' };

export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const ctx = await requireContext();
  const settings = await loadSettings(ctx);
  const detail = await loadCustomer(ctx, id, todayIn(settings.timezone));
  if (!detail) notFound();
  const role = ctx.membership.role;
  const manager = isManager(role);
  const people = await loadPeople(ctx);
  const labels = labelMap(people);
  const { customer: c, signal, segment } = detail;
  const writable = canWrite(role) && !c.archived_at && !c.anonymized_at;
  const tz = settings.timezone;
  const now = Date.parse(nowIso());
  const sg = segment?.segment_key as SegmentKey | undefined;

  return (
    <>
      <PageHeader title={c.name} description={[c.company_name, c.customer_type === 'company' ? 'Empresa' : 'Pessoa'].filter(Boolean).join(' · ')}>
        <CustomerHeaderActions id={c.id} archived={Boolean(c.archived_at)} anonymized={Boolean(c.anonymized_at)} canManage={manager} canAdmin={isAdmin(role)} />
      </PageHeader>

      {c.anonymized_at ? <div className="mb-4"><Alert tone="info">Este cliente foi anonimizado em {formatDateTime(c.anonymized_at, tz)}. Os dados pessoais foram removidos; compras e números agregados foram mantidos.</Alert></div> : null}
      {c.archived_at ? <div className="mb-4"><Alert tone="warning">Cliente arquivado. Restaure para editar, registrar compras ou incluir em campanhas.</Alert></div> : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Resumo">
            <div className="flex flex-wrap items-center gap-3">
              <StateBadge state={signal?.state} />
              <SegmentBadge segment={segment?.segment_key} />
              {signal?.signals.map((s) => <Badge key={s} tone="warning">{s === 'inactivity' ? 'Inatividade' : s === 'cycle' ? 'Ciclo vencido' : 'Queda de frequência'}</Badge>)}
            </div>
            <dl className="mt-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <div><dt className="text-xs text-muted">E-mail</dt><dd className="break-all">{c.email ?? '—'}</dd></div>
              <div><dt className="text-xs text-muted">Telefone</dt><dd>{formatPhone(c.phone) || '—'}</dd></div>
              <div><dt className="text-xs text-muted">CPF / CNPJ</dt><dd>{formatDocument(c.document_number) || '—'}</dd></div>
              <div><dt className="text-xs text-muted">Responsável</dt><dd>{c.assigned_to ? labels.get(c.assigned_to) ?? 'Usuário' : <span className="text-warning">Sem responsável</span>}</dd></div>
              <div><dt className="text-xs text-muted">Pedidos válidos</dt><dd className="tabular-nums">{signal?.n_valid ?? 0}</dd></div>
              <div><dt className="text-xs text-muted">Total gasto (líquido)</dt><dd className="tabular-nums">{formatBRL(signal?.net_total_cents ?? 0)}</dd></div>
              <div><dt className="text-xs text-muted">Primeira compra</dt><dd>{formatDate(signal?.first_at)}</dd></div>
              <div><dt className="text-xs text-muted">Última compra</dt><dd>{formatDate(signal?.last_at)}{signal?.days_since != null ? ` (${formatDays(signal.days_since)})` : ''}</dd></div>
              <div><dt className="text-xs text-muted">Intervalo mediano entre compras</dt><dd>{signal?.median_interval != null ? formatDays(Math.round(signal.median_interval)) : '—'}</dd></div>
              <div><dt className="text-xs text-muted">Ticket mediano</dt><dd className="tabular-nums">{formatBRL(signal?.median_ticket_cents)}</dd></div>
              <div><dt className="text-xs text-muted">Último produto</dt><dd>{detail.lastProduct ?? '—'}</dd></div>
              <div><dt className="text-xs text-muted">Cadastrado em</dt><dd>{formatDateTime(c.created_at, tz)}</dd></div>
            </dl>
            {c.notes ? <p className="mt-4 whitespace-pre-wrap break-words rounded-md bg-black/5 p-3 text-sm dark:bg-white/5">{c.notes}</p> : null}
          </Card>

          <Card title="Compras" description="Só compras concluídas com valor líquido maior que zero contam nos indicadores. Cancelamentos e estornos totais são desfeitos nos resultados.">
            {writable ? <div className="mb-4"><Link className="inline-flex min-h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90" href={`/compras/nova?cliente=${c.id}`}>Registrar compra</Link></div> : null}
            <PurchaseList purchases={detail.purchases} items={detail.items} timezone={tz} canManage={manager && !c.anonymized_at} />
          </Card>

          <Card title="Tarefas e atividades" description="Contatos são manuais: registre aqui o que foi feito ou combinado.">
            {writable ? <div className="mb-6"><ActivityForm customerId={c.id} people={personOptions(people)} /></div> : null}
            <ActivityList activities={detail.activities} customerId={c.id} canWrite={writable} labels={labels} timezone={tz} now={now} />
          </Card>

          {writable ? <Card title="Editar dados do cliente"><CustomerForm id={c.id} initial={{ name: c.name, customer_type: c.customer_type, email: c.email ?? '', phone: c.phone ?? '', document_number: c.document_number ?? '', company_name: c.company_name ?? '', external_customer_id: c.external_customer_id ?? '', notes: c.notes ?? '' }} /></Card> : null}
        </div>

        <div className="space-y-4">
          <Card title="Segmento RFM" description="Pontuação de 1 a 5 em recência, frequência e valor na última rodada.">
            {segment && sg ? (
              <div className="space-y-2 text-sm">
                <p><strong>{SEGMENT_LABELS[sg] ?? sg}</strong> — {SEGMENT_HINTS[sg] ?? ''}</p>
                {segment.r_score != null ? <p className="tabular-nums">R {segment.r_score} · F {segment.f_score} · M {segment.m_score}</p> : <p className="text-muted">Sem compras na janela da análise: sem notas.</p>}
                {detail.history.length > 1 ? (
                  <details className="text-xs">
                    <summary className="cursor-pointer text-muted">Histórico de rodadas</summary>
                    <ul className="mt-1 space-y-1">{detail.history.map((h) => <li key={h.model_version}>v{h.model_version} · {formatDate(h.reference_date)} · {SEGMENT_LABELS[h.segment_key as SegmentKey] ?? h.segment_key}{h.r_score != null ? ` (R${h.r_score} F${h.f_score} M${h.m_score})` : ''}</li>)}</ul>
                  </details>
                ) : null}
              </div>
            ) : <p className="text-sm text-muted">Ainda não há rodada RFM. Um gestor pode calcular em «Segmentação».</p>}
          </Card>

          <Card title="Oportunidades de reativação"><OpportunityMini rows={detail.opportunities} /></Card>

          <Card title="Permissão de contato" description="Quem pode ser contatado, por canal. Sem registro, o cliente fica fora das campanhas.">
            <ContactPanel preferences={detail.preferences} suppressions={detail.suppressions} canLift={manager} />
            {writable ? (
              <div className="mt-4 space-y-4 border-t border-border pt-4">
                <PreferenceForm customerId={c.id} />
                <details><summary className="cursor-pointer text-sm text-muted">Incluir na lista de supressão</summary><div className="mt-3"><SuppressionForm customerId={c.id} /></div></details>
              </div>
            ) : null}
          </Card>

          {manager && !c.archived_at && !c.anonymized_at ? <Card title="Carteira"><AssignControl id={c.id} current={c.assigned_to} people={personOptions(people)} /></Card> : null}
          <Card title="Campanhas"><CustomerCampaigns rows={detail.campaigns} timezone={tz} /></Card>
          <Card title="Linha do tempo"><EventTimeline events={detail.events} timezone={tz} /></Card>
        </div>
      </div>
    </>
  );
}
