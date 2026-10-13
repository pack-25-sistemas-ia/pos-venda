import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge, EmptyState, PageHeader } from '@/components/ui/primitives';
import { MarkAllButton, MarkOneButton } from '@/components/pv/notification-actions';
import { requireContext } from '@/lib/auth/session';
import { listNotifications, loadSettings } from '@/lib/pv/data';
import { formatDateTime } from '@/lib/pv/format';

export const metadata: Metadata = { title: 'Notificações' };

export default async function NotificationsPage() {
  const ctx = await requireContext();
  const [rows, settings] = await Promise.all([listNotifications(ctx), loadSettings(ctx)]);
  const unread = rows.filter((n) => !n.read_at).length;
  return (
    <>
      <PageHeader title="Notificações" description="Avisos internos: tarefas vencidas, novas oportunidades, clientes que recompraram e importações concluídas. Nada é enviado por e-mail ou WhatsApp.">
        {unread > 0 ? <MarkAllButton /> : null}
      </PageHeader>
      {rows.length === 0 ? <EmptyState title="Sem notificações" description="Quando algo pedir sua atenção, aparece aqui." /> : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-card">
          {rows.map((n) => (
            <li key={n.id} className="flex flex-wrap items-start justify-between gap-3 p-4 text-sm">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={n.read_at ? 'font-medium text-muted' : 'font-semibold'}>{n.title}</span>
                  {!n.read_at ? <Badge tone="warning">Nova</Badge> : null}
                </div>
                {n.body ? <p className="mt-1 text-muted">{n.body}</p> : null}
                <p className="mt-1 text-xs text-muted">{formatDateTime(n.created_at, settings.timezone)}{n.link ? <> · <Link className="underline" href={n.link}>Abrir</Link></> : null}</p>
              </div>
              {!n.read_at ? <MarkOneButton id={n.id} /> : null}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
