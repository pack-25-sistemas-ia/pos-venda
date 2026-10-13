import type { Metadata } from 'next';
import { Badge, Card, PageHeader } from '@/components/ui/primitives';
import { DeleteTemplateButton, TemplateForm } from '@/components/pv/campaign-forms';
import { requireContext } from '@/lib/auth/session';
import { isManager } from '@/lib/pv/access';
import { listTemplates } from '@/lib/pv/data';
import { CHANNEL_LABELS } from '@/lib/pv/filters';
import { TEMPLATE_VARIABLES } from '@/lib/pv/templates';

export const metadata: Metadata = { title: 'Modelos de mensagem' };

export default async function TemplatesPage() {
  const ctx = await requireContext();
  const manager = isManager(ctx.membership.role);
  const templates = await listTemplates(ctx);
  return (
    <>
      <PageHeader title="Modelos de mensagem" description="Textos de apoio para o contato manual. O sistema não envia mensagens: a equipe copia o texto e usa o canal da empresa." />
      <Card title="Variáveis disponíveis" description="Use {{variavel}} ou {{variavel|valor padrão}} quando o dado puder faltar.">
        <ul className="flex flex-wrap gap-2 text-sm">{TEMPLATE_VARIABLES.map((v) => <li key={v.key}><Badge tone="neutral">{`{{${v.key}}}`}</Badge> <span className="text-xs text-muted">{v.label}</span></li>)}</ul>
      </Card>
      <div className="mt-4 space-y-4">
        {templates.map((t) => (
          <Card key={t.id} title={t.name} description={`${CHANNEL_LABELS[t.channel]}${t.active ? '' : ' · inativo'}`}>
            {manager ? (
              <div className="space-y-3">
                <TemplateForm id={t.id} initial={{ name: t.name, channel: t.channel, subject: t.subject ?? '', body: t.body, active: t.active }} />
                <DeleteTemplateButton id={t.id} />
              </div>
            ) : <p className="whitespace-pre-wrap break-words text-sm">{t.body}</p>}
          </Card>
        ))}
        {manager ? <Card title="Novo modelo"><TemplateForm /></Card> : null}
      </div>
    </>
  );
}
