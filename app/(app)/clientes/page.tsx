import type { Metadata } from 'next';
import Link from 'next/link';
import { EmptyState, PageHeader } from '@/components/ui/primitives';
import { ListFilters, Pagination } from '@/components/app/list-bits';
import { CustomersTable } from '@/components/pv/tables';
import { requireContext } from '@/lib/auth/session';
import { canWrite, isManager, one, type SearchParams } from '@/lib/pv/access';
import { labelMap, listCustomers, loadPeople, loadSettings, parsePage, personOptions, searchToken } from '@/lib/pv/data';
import { CUSTOMER_STATES, SEGMENT_KEYS, STATE_LABELS, todayIn } from '@/lib/pv/filters';
import { SEGMENT_LABELS, type SegmentKey } from '@/lib/pv/rfm';

export const metadata: Metadata = { title: 'Clientes' };

export default async function CustomersPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireContext();
  const sp = await searchParams;
  const manager = isManager(ctx.membership.role);
  const q = searchToken(sp.q);
  const pick = (key: string, allowed: readonly string[]) => { const v = one(sp[key]); return allowed.includes(v) ? v : ''; };
  const uuidOrEmpty = (key: string) => { const v = one(sp[key]); return /^[0-9a-f-]{36}$/i.test(v) ? v : ''; };
  const filters = {
    q, state: pick('state', CUSTOMER_STATES), segment: pick('segment', SEGMENT_KEYS), seller: manager ? uuidOrEmpty('seller') : '',
    unassigned: one(sp.unassigned) === '1', archived: one(sp.archived) === '1', page: parsePage(sp.page),
  };
  const settings = await loadSettings(ctx);
  const [{ rows, total, truncated }, people] = await Promise.all([listCustomers(ctx, filters, todayIn(settings.timezone)), loadPeople(ctx)]);
  const owners = Object.fromEntries(labelMap(people));
  const params = { q, state: filters.state, segment: filters.segment, seller: filters.seller, unassigned: filters.unassigned ? '1' : '', archived: filters.archived ? '1' : '' };
  const chip = (label: string, key: 'unassigned' | 'archived') => {
    const next = new URLSearchParams(Object.entries(params).filter(([k, v]) => v && k !== key));
    if (!filters[key]) next.set(key, '1');
    const on = filters[key];
    return <Link key={key} href={`/clientes?${next.toString()}`} aria-pressed={on} className={`inline-flex min-h-9 items-center rounded-full border px-3 text-xs font-medium ${on ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:bg-black/5 dark:hover:bg-white/5'}`}>{label}</Link>;
  };
  const exportQs = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
  const linkBtn = 'inline-flex min-h-10 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/5';

  return (
    <>
      <PageHeader title="Clientes" description={manager ? 'Todos os clientes da organização.' : 'Os clientes da sua carteira.'}>
        <div className="flex flex-wrap gap-2">
          {manager ? <a className={linkBtn} href={`/export/clientes${exportQs ? `?${exportQs}` : ''}`}>Exportar CSV</a> : null}
          {manager ? <Link className={linkBtn} href="/clientes/importar">Importar CSV</Link> : null}
          {canWrite(ctx.membership.role) ? <Link className="inline-flex min-h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90" href="/clientes/novo">Novo cliente</Link> : null}
        </div>
      </PageHeader>

      <ListFilters
        action="/clientes" q={q} placeholder="Nome, e-mail, telefone, CPF/CNPJ ou empresa"
        selects={[
          { name: 'state', label: 'Situação', value: filters.state, all: 'Todas', options: CUSTOMER_STATES.map((s) => ({ value: s, label: STATE_LABELS[s] })) },
          { name: 'segment', label: 'Segmento RFM', value: filters.segment, all: 'Todos', options: SEGMENT_KEYS.map((s) => ({ value: s, label: SEGMENT_LABELS[s as SegmentKey] })) },
          ...(manager ? [{ name: 'seller', label: 'Responsável', value: filters.seller, all: 'Todos', options: personOptions(people) }] : []),
        ]}
        hidden={{ ...(filters.unassigned ? { unassigned: '1' } : {}), ...(filters.archived ? { archived: '1' } : {}) }}
      />
      <div className="mb-4 flex flex-wrap gap-2" aria-label="Filtros rápidos">
        {manager ? chip('Sem responsável', 'unassigned') : null}
        {chip('Arquivados', 'archived')}
      </div>
      {truncated ? <p className="mb-3 text-xs text-warning">Mostrando os primeiros 5.000 clientes que atendem à busca. Refine os filtros para ver os demais.</p> : null}

      <CustomersTable
        rows={rows} owners={owners}
        empty={<EmptyState title="Nenhum cliente encontrado" description="Ajuste os filtros, importe sua base por CSV ou cadastre o primeiro cliente."><Link className="underline" href="/clientes/importar">Importar clientes</Link></EmptyState>}
      />
      <Pagination basePath="/clientes" page={filters.page} total={total} params={params} />
    </>
  );
}
