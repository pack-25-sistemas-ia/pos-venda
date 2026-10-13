import type { Metadata } from 'next';
import { Card, PageHeader } from '@/components/ui/primitives';
import { CampaignForm } from '@/components/pv/campaign-forms';
import { requireContext } from '@/lib/auth/session';
import { MANAGER_ROLES } from '@/lib/pv/access';
import { listSegmentDefs, listTemplates, loadPeople, personOptions } from '@/lib/pv/data';

export const metadata: Metadata = { title: 'Nova campanha' };

export default async function NewCampaignPage() {
  const ctx = await requireContext(MANAGER_ROLES);
  const [segments, templates, people] = await Promise.all([listSegmentDefs(ctx), listTemplates(ctx), loadPeople(ctx)]);
  return (
    <>
      <PageHeader title="Nova campanha" description="A campanha nasce como rascunho. Depois você calcula o público, revisa e inicia." />
      <Card>
        <CampaignForm
          segments={segments.filter((s) => s.active).map((s) => ({ value: s.id, label: s.name }))} people={personOptions(people)}
          templates={templates.filter((t) => t.active).map((t) => ({ id: t.id, name: t.name, channel: t.channel, subject: t.subject, body: t.body }))}
        />
      </Card>
    </>
  );
}
