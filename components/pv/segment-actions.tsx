'use client';

import { ActionButton } from '@/components/app/form-kit';
import { deleteSegment, refreshSegment, refreshOpportunities, runRfm } from '@/lib/pv/actions';

export const RunRfmButton = () => <ActionButton label="Calcular nova rodada RFM" pendingLabel="Calculando…" variant="primary" action={runRfm} />;
export const RefreshOpportunitiesButton = () => <ActionButton label="Atualizar análise de risco" pendingLabel="Analisando…" variant="primary" action={refreshOpportunities} />;
export const RefreshSegmentButton = ({ id }: { id: string }) => <ActionButton label="Atualizar" pendingLabel="…" action={() => refreshSegment(id)} />;
export const DeleteSegmentButton = ({ id }: { id: string }) => <ActionButton label="Excluir" variant="ghost" action={() => deleteSegment(id)} confirm="Excluir este segmento? Campanhas existentes mantêm o público já calculado." />;
