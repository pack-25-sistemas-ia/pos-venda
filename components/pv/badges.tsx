import { Badge } from '@/components/ui/primitives';
import { CAMPAIGN_STATUS_LABELS, CONTACT_STATUS_LABELS, OPP_REASON_LABELS, OPP_STATUS_LABELS, STATE_LABELS, type CustomerState } from '@/lib/pv/filters';
import { priorityLabel, priorityTone, segmentTone, stateTone } from '@/lib/pv/format';
import { SEGMENT_LABELS, type SegmentKey } from '@/lib/pv/rfm';

// O texto sempre acompanha a cor: nada depende só de cor.
export function StateBadge({ state }: { state: CustomerState | null | undefined }) {
  if (!state) return <span className="text-xs text-muted">—</span>;
  return <Badge tone={stateTone(state)}>{STATE_LABELS[state]}</Badge>;
}

export function SegmentBadge({ segment }: { segment: string | null | undefined }) {
  if (!segment) return <span className="text-xs text-muted">Sem rodada RFM</span>;
  return <Badge tone={segmentTone(segment)}>{SEGMENT_LABELS[segment as SegmentKey] ?? segment}</Badge>;
}

export function PriorityBadge({ priority, high, medium }: { priority: number; high: number; medium: number }) {
  return <Badge tone={priorityTone(priority, high, medium)}>{priorityLabel(priority, high, medium)} · {priority}</Badge>;
}

const OPP_TONE = { open: 'warning', in_progress: 'warning', reactivated: 'success', discarded: 'neutral' } as const;
export function OppStatusBadge({ status }: { status: keyof typeof OPP_STATUS_LABELS }) {
  return <Badge tone={OPP_TONE[status]}>{OPP_STATUS_LABELS[status]}</Badge>;
}
export const reasonLabel = (r: string) => OPP_REASON_LABELS[r as keyof typeof OPP_REASON_LABELS] ?? r;

const CAMP_TONE = { draft: 'neutral', planned: 'neutral', running: 'success', paused: 'warning', completed: 'success', cancelled: 'danger' } as const;
export function CampaignStatusBadge({ status }: { status: keyof typeof CAMPAIGN_STATUS_LABELS }) {
  return <Badge tone={CAMP_TONE[status]}>{CAMPAIGN_STATUS_LABELS[status]}</Badge>;
}

const CONTACT_TONE = { planned: 'neutral', contacted: 'warning', responded: 'success', no_response: 'neutral', refused: 'danger' } as const;
export function ContactStatusBadge({ status }: { status: keyof typeof CONTACT_STATUS_LABELS }) {
  return <Badge tone={CONTACT_TONE[status]}>{CONTACT_STATUS_LABELS[status]}</Badge>;
}

const MEMBER_LABELS: Record<string, string> = {
  eligible: 'Elegível', assigned: 'Atribuído', contacted: 'Contatado', responded: 'Respondeu', no_response: 'Sem resposta', refused: 'Recusou', rebought: 'Recomprou (observado)', excluded: 'Fora do público',
};
export const memberLabel = (s: string) => MEMBER_LABELS[s] ?? s;
export function MemberBadge({ status }: { status: string }) {
  const tone = status === 'rebought' || status === 'responded' ? 'success' : status === 'refused' ? 'danger' : status === 'excluded' ? 'neutral' : status === 'contacted' ? 'warning' : 'neutral';
  return <Badge tone={tone}>{memberLabel(status)}</Badge>;
}

const EXCLUSION_LABELS: Record<string, string> = {
  arquivado: 'Cliente arquivado', anonimizado: 'Cliente anonimizado', suprimido: 'Na lista de supressão', sem_permissao_registrada: 'Sem permissão de contato registrada', permissao_negada: 'Contato negado pelo cliente',
};
export const exclusionLabel = (r: string | null) => (r ? EXCLUSION_LABELS[r] ?? r : '');
