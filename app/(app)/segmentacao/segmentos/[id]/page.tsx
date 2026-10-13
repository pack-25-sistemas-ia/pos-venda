import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Card, PageHeader } from '@/components/ui/primitives';
import { SegmentBuilder } from '@/components/pv/segment-builder';
import { requireContext } from '@/lib/auth/session';
import { isManager } from '@/lib/pv/access';
import { listSegmentDefs, loadPeople, personOptions } from '@/lib/pv/data';
import type { Criteria } from '@/lib/pv/segments';

export const metadata: Metadata = { title: 'Segmento' };

export default async function SegmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const isNew = id === 'novo';
  if (!isNew && !/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const ctx = await requireContext();
  const manager = isManager(ctx.membership.role);
  if (isNew && !manager) notFound();
  const [defs, people] = await Promise.all([listSegmentDefs(ctx), loadPeople(ctx)]);
  const def = isNew ? null : defs.find((d) => d.id === id);
  if (!isNew && !def) notFound();
  const initial: Criteria = def?.criteria_json ?? { match: 'all', conditions: [{ field: 'days_since_last', op: 'gte', value: 90 }] };
  return (
    <>
      <PageHeader title={isNew ? 'Novo segmento' : def!.name} description="Defina quem entra no segmento. O resultado pode ser usado como público de uma campanha." />
      <Card>
        <SegmentBuilder
          id={isNew ? null : id} initialName={def?.name ?? ''} initialDescription={def?.description ?? ''} initialCriteria={initial}
          sellers={personOptions(people)} readOnly={!manager || def?.segment_type === 'system'}
        />
      </Card>
    </>
  );
}
