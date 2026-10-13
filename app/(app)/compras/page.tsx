import type { Metadata } from 'next';
import Link from 'next/link';
import { EmptyState, PageHeader } from '@/components/ui/primitives';
import { ListFilters, Pagination } from '@/components/app/list-bits';
import { PurchasesTable } from '@/components/pv/tables';
import { requireContext } from '@/lib/auth/session';
import { canWrite, isManager, one, type SearchParams } from '@/lib/pv/access';
import { listPurchases, loadSettings, parsePage, searchToken } from '@/lib/pv/data';
import { isRealDate } from '@/lib/pv/filters';

export const metadata: Metadata = { title: 'Compras' };

export default async function PurchasesPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireContext();
  const sp = await searchParams;
  const manager = isManager(ctx.membership.role);
  const q = searchToken(sp.q);
  const status = ['valid', 'cancelled', 'refunded'].includes(one(sp.status)) ? one(sp.status) : '';
  const customer = /^[0-9a-f-]{36}$/i.test(one(sp.cliente)) ? one(sp.cliente) : '';
  const from = isRealDate(one(sp.from)) ? one(sp.from) : '';
  const to = isRealDate(one(sp.to)) ? one(sp.to) : '';
  const page = parsePage(sp.page);
  const [{ rows, total }, settings] = await Promise.all([listPurchases(ctx, { q, status, customer, from, to, page }), loadSettings(ctx)]);
  const params = { q, status, cliente: customer, from, to };
  const linkBtn = 'inline-flex min-h-10 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/5';
  const exportQs = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();

  return (
    <>
      <PageHeader title="Compras" description="Histórico de compras. Só as concluídas e com valor líquido maior que zero contam nos indicadores.">
        <div className="flex flex-wrap gap-2">
          {manager ? <a className={linkBtn} href={`/export/compras${exportQs ? `?${exportQs}` : ''}`}>Exportar CSV</a> : null}
          {manager ? <Link className={linkBtn} href="/compras/importar">Importar CSV</Link> : null}
          {canWrite(ctx.membership.role) ? <Link className="inline-flex min-h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90" href="/compras/nova">Nova compra</Link> : null}
        </div>
      </PageHeader>

      <ListFilters
        action="/compras" q={q} placeholder="Número do pedido"
        selects={[{ name: 'status', label: 'Situação', value: status, all: 'Todas', options: [{ value: 'valid', label: 'Válidas' }, { value: 'cancelled', label: 'Canceladas' }, { value: 'refunded', label: 'Com estorno' }] }]}
        hidden={{ ...(customer ? { cliente: customer } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}) }}
      />
      <PurchasesTable
        rows={rows} timezone={settings.timezone}
        empty={<EmptyState title="Nenhuma compra encontrada" description="Importe o histórico de compras por CSV ou registre uma compra manualmente."><Link className="underline" href="/compras/importar">Importar compras</Link></EmptyState>}
      />
      <Pagination basePath="/compras" page={page} total={total} params={params} />
    </>
  );
}
