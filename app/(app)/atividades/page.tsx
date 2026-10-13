import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge, EmptyState, PageHeader } from '@/components/ui/primitives';
import { ActivityToggle } from '@/components/pv/customer-forms';
import { requireContext } from '@/lib/auth/session';
import { nowIso } from '@/lib/time';
import { canWrite, isManager, one, type SearchParams } from '@/lib/pv/access';
import { labelMap, listOpenActivities, loadPeople, loadSettings } from '@/lib/pv/data';
import { activityLabel, formatDateTime, overdue } from '@/lib/pv/format';

export const metadata: Metadata = { title: 'Tarefas' };

export default async function ActivitiesPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireContext();
  const sp = await searchParams;
  const manager = isManager(ctx.membership.role);
  const mine = !manager || one(sp.escopo) !== 'todas';
  const [rows, people, settings] = await Promise.all([listOpenActivities(ctx, mine), loadPeople(ctx), loadSettings(ctx)]);
  const labels = labelMap(people);
  const now = Date.parse(nowIso());
  const writable = canWrite(ctx.membership.role);
  const late = rows.filter((a) => overdue(a, now)).length;
  const tab = (href: string, label: string, on: boolean) => <Link key={href} href={href} aria-current={on ? 'page' : undefined} className={`inline-flex min-h-9 items-center rounded-full border px-3 text-xs font-medium ${on ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:bg-black/5 dark:hover:bg-white/5'}`}>{label}</Link>;

  return (
    <>
      <PageHeader title="Tarefas" description="Contatos e acompanhamentos pendentes dos clientes. As tarefas são criadas na ficha do cliente ou numa oportunidade de reativação." />
      {manager ? <div className="mb-4 flex gap-2">{tab('/atividades', 'Minhas tarefas', mine)}{tab('/atividades?escopo=todas', 'Todas da organização', !mine)}</div> : null}
      {late > 0 ? <p className="mb-3 text-sm text-danger">{late} tarefa(s) vencida(s).</p> : null}
      {rows.length === 0 ? <EmptyState title="Nenhuma tarefa pendente" description="Tudo em dia. Crie tarefas a partir da ficha de um cliente." /> : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-card">
          {rows.map((a) => {
            const isLate = overdue(a, now);
            return (
              <li key={a.id} className="flex flex-wrap items-start justify-between gap-3 p-4 text-sm">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link className="font-medium underline-offset-2 hover:underline" href={`/clientes/${a.customer_id}`}>{a.customer_name}</Link>
                    <span>· {a.title ?? activityLabel(a.type)}</span>
                    <Badge tone="neutral">{activityLabel(a.type)}</Badge>
                    {isLate ? <Badge tone="danger">Vencida</Badge> : null}
                    {a.priority === 'high' ? <Badge tone="danger">Prioridade alta</Badge> : null}
                  </div>
                  {a.description ? <p className="mt-1 whitespace-pre-wrap break-words text-muted">{a.description}</p> : null}
                  <p className="mt-1 text-xs text-muted">{a.due_at ? `Prazo ${formatDateTime(a.due_at, settings.timezone)}` : 'Sem prazo'}{a.assigned_to ? ` · Responsável ${labels.get(a.assigned_to) ?? 'Usuário'}` : ''}{a.opportunity_id ? <> · <Link className="underline" href={`/reativacao/${a.opportunity_id}`}>oportunidade</Link></> : null}{a.campaign_id ? <> · <Link className="underline" href={`/campanhas/${a.campaign_id}`}>campanha</Link></> : null}</p>
                </div>
                {writable ? <ActivityToggle id={a.id} customerId={a.customer_id} done={false} /> : null}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
