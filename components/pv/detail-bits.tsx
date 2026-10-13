import Link from 'next/link';
import { Badge } from '@/components/ui/primitives';
import type { ActivityRow, CampaignRow, ContactRow, ItemRow, LifecycleEvent, MembershipRow, OpportunityRow, PreferenceRow, PurchaseRow, SuppressionRow } from '@/lib/pv/data';
import { CHANNEL_LABELS, PERMISSION_LABELS } from '@/lib/pv/filters';
import { activityLabel, formatBRL, formatDateTime, formatDay, overdue } from '@/lib/pv/format';
import { SEGMENT_LABELS, type SegmentKey } from '@/lib/pv/rfm';
import { ActivityToggle, LiftSuppressionButton, PurchaseRowActions } from './customer-forms';
import { CampaignStatusBadge, ContactStatusBadge, MemberBadge, OppStatusBadge, exclusionLabel, reasonLabel } from './badges';

export function PurchaseList({ purchases, items, timezone, canManage }: { purchases: PurchaseRow[]; items: Map<string, ItemRow[]>; timezone: string; canManage: boolean }) {
  if (purchases.length === 0) return <p className="text-sm text-muted">Nenhuma compra registrada.</p>;
  return (
    <ul className="divide-y divide-border">
      {purchases.map((p) => (
        <li key={p.id} className="py-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{formatDay(p.purchased_at, timezone)}</span>
              {p.external_order_id ? <span className="text-xs text-muted">Pedido {p.external_order_id}</span> : null}
              {p.status === 'cancelled' ? <Badge tone="danger">Cancelada</Badge> : p.is_valid ? <Badge tone="success">Válida</Badge> : <Badge tone="neutral">Estornada</Badge>}
            </div>
            <div className="text-right tabular-nums">
              <div className="font-medium">{formatBRL(p.net_cents)}</div>
              {p.refunded_cents > 0 ? <div className="text-xs text-muted">Total {formatBRL(p.total_cents)} · estornado {formatBRL(p.refunded_cents)}</div> : null}
            </div>
          </div>
          {(items.get(p.id) ?? []).length ? (
            <ul className="mt-1 list-disc pl-5 text-xs text-muted">
              {(items.get(p.id) ?? []).map((it) => <li key={it.id}>{it.product_name}{it.category ? ` (${it.category})` : ''} · {Number(it.quantity).toLocaleString('pt-BR')} × {formatBRL(it.unit_price_cents)}</li>)}
            </ul>
          ) : null}
          {canManage && p.status === 'completed' ? <div className="mt-2"><PurchaseRowActions id={p.id} customerId={p.customer_id} net={p.net_cents} valid={p.is_valid} canManage /></div> : null}
        </li>
      ))}
    </ul>
  );
}

const EVENT_LABELS: Record<string, string> = {
  first_purchase: 'Primeira compra', purchase: 'Nova compra', at_risk: 'Entrou em risco', inactive: 'Ficou inativo', reactivated: 'Voltou a comprar (reativação observada)',
  segment_changed: 'Mudou de segmento RFM', contact: 'Contato de campanha registrado', campaign_added: 'Incluído em campanha',
};
function eventDetail(e: LifecycleEvent): string {
  const m = e.metadata;
  if (e.event_type === 'segment_changed') return `${SEGMENT_LABELS[m.from as SegmentKey] ?? String(m.from)} → ${SEGMENT_LABELS[m.to as SegmentKey] ?? String(m.to)}`;
  if (e.event_type === 'at_risk' || e.event_type === 'inactive') return typeof m.days_since_last === 'number' ? `${m.days_since_last} dias sem comprar` : '';
  if (e.event_type === 'reactivated' && typeof m.net_cents === 'number') return formatBRL(m.net_cents);
  return '';
}
export function EventTimeline({ events, timezone }: { events: LifecycleEvent[]; timezone: string }) {
  if (events.length === 0) return <p className="text-sm text-muted">Sem eventos ainda.</p>;
  return (
    <ol className="space-y-2 text-sm">
      {events.map((e) => (
        <li key={e.id} className="border-l-2 border-border pl-3">
          <div className="font-medium">{EVENT_LABELS[e.event_type] ?? e.event_type}</div>
          <div className="text-xs text-muted">{formatDateTime(e.occurred_at, timezone)}{eventDetail(e) ? ` · ${eventDetail(e)}` : ''}</div>
        </li>
      ))}
    </ol>
  );
}

export function OpportunityMini({ rows }: { rows: OpportunityRow[] }) {
  if (rows.length === 0) return <p className="text-sm text-muted">Nenhuma oportunidade de reativação.</p>;
  return (
    <ul className="space-y-2 text-sm">
      {rows.map((o) => (
        <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-2">
          <span>{reasonLabel(o.reason)} · prioridade {o.priority}</span>
          <span className="flex items-center gap-2"><OppStatusBadge status={o.status} /><Link className="text-xs underline" href={`/reativacao/${o.id}`}>Explicação</Link></span>
        </li>
      ))}
    </ul>
  );
}

export function ActivityList({ activities, customerId, canWrite, labels, timezone, now }: { activities: ActivityRow[]; customerId: string; canWrite: boolean; labels: Map<string, string>; timezone: string; now: number }) {
  if (activities.length === 0) return <p className="text-sm text-muted">Nenhuma tarefa ou atividade.</p>;
  return (
    <ul className="divide-y divide-border">
      {activities.map((a) => {
        const late = !a.completed_at && overdue(a, now);
        return (
          <li key={a.id} className="flex flex-wrap items-start justify-between gap-3 py-3 text-sm">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{a.title ?? activityLabel(a.type)}</span>
                <Badge tone="neutral">{activityLabel(a.type)}</Badge>
                {a.completed_at ? <Badge tone="success">Concluída</Badge> : late ? <Badge tone="danger">Vencida</Badge> : <Badge tone="warning">Pendente</Badge>}
                {a.priority === 'high' ? <Badge tone="danger">Prioridade alta</Badge> : null}
              </div>
              {a.description ? <p className="mt-1 whitespace-pre-wrap break-words text-muted">{a.description}</p> : null}
              <p className="mt-1 text-xs text-muted">
                {a.due_at ? `Prazo ${formatDateTime(a.due_at, timezone)} · ` : ''}
                {a.assigned_to ? `Responsável ${labels.get(a.assigned_to) ?? 'Usuário'} · ` : ''}
                {a.completed_at ? `Concluída em ${formatDateTime(a.completed_at, timezone)}` : `Criada em ${formatDateTime(a.created_at, timezone)}`}
              </p>
            </div>
            {canWrite ? <ActivityToggle id={a.id} customerId={customerId} done={Boolean(a.completed_at)} /> : null}
          </li>
        );
      })}
    </ul>
  );
}

export function ContactPanel({ preferences, suppressions, canLift }: { preferences: PreferenceRow[]; suppressions: SuppressionRow[]; canLift: boolean }) {
  const active = suppressions.filter((s) => !s.lifted_at);
  return (
    <div className="space-y-4 text-sm">
      <div>
        <p className="mb-1 text-xs font-medium text-muted">Permissão de contato por canal</p>
        {preferences.length === 0 ? <p className="text-muted">Nenhuma permissão registrada: o cliente não entra em campanhas.</p> : (
          <ul className="space-y-1">
            {preferences.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>{CHANNEL_LABELS[p.channel]}</span>
                <span className="flex items-center gap-2">
                  <Badge tone={p.permission_status === 'denied' ? 'danger' : 'success'}>{PERMISSION_LABELS[p.permission_status]}</Badge>
                  {p.legal_basis_reference ? <span className="max-w-48 truncate text-xs text-muted" title={p.legal_basis_reference}>{p.legal_basis_reference}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <p className="mb-1 text-xs font-medium text-muted">Lista de supressão</p>
        {active.length === 0 ? <p className="text-muted">Fora da lista de supressão.</p> : (
          <ul className="space-y-1">
            {active.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>{s.channel ? CHANNEL_LABELS[s.channel] : 'Todos os canais'} — {s.reason}</span>
                {canLift ? <LiftSuppressionButton id={s.id} customerId={s.customer_id} /> : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function CustomerCampaigns({ rows, timezone }: { rows: Array<{ campaign: CampaignRow; membership: MembershipRow; contacts: ContactRow[] }>; timezone: string }) {
  if (rows.length === 0) return <p className="text-sm text-muted">Nunca participou de campanhas.</p>;
  return (
    <ul className="space-y-3 text-sm">
      {rows.map(({ campaign, membership, contacts }) => (
        <li key={campaign.id} className="rounded-md border border-border p-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Link className="font-medium underline-offset-2 hover:underline" href={`/campanhas/${campaign.id}`}>{campaign.name}</Link>
            <span className="flex items-center gap-2"><CampaignStatusBadge status={campaign.status} /><MemberBadge status={membership.status} /></span>
          </div>
          {membership.exclusion_reason ? <p className="mt-1 text-xs text-muted">{exclusionLabel(membership.exclusion_reason)}</p> : null}
          {contacts.map((c) => (
            <p key={c.id} className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted"><ContactStatusBadge status={c.contact_status} /> {formatDateTime(c.contacted_at ?? c.created_at, timezone)}{c.notes ? ` · ${c.notes}` : ''}</p>
          ))}
        </li>
      ))}
    </ul>
  );
}
