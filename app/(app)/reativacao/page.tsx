import type { Metadata } from 'next';
import Link from 'next/link';
import { Alert, EmptyState, PageHeader } from '@/components/ui/primitives';
import { ListFilters, Pagination } from '@/components/app/list-bits';
import { RefreshOpportunitiesButton } from '@/components/pv/segment-actions';
import { OpportunitiesTable } from '@/components/pv/tables';
import { requireContext } from '@/lib/auth/session';
import { isManager, one, type SearchParams } from '@/lib/pv/access';
import { labelMap, listOpportunities, loadPeople, loadSettings, parsePage, personOptions } from '@/lib/pv/data';
import { OPP_REASON_LABELS, OPP_STATUS_LABELS } from '@/lib/pv/filters';

export const metadata: Metadata = { title: 'Reativação' };

export default async function ReactivationPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireContext();
  const sp = await searchParams;
  const manager = isManager(ctx.membership.role);
  const pick = (key: string, allowed: readonly string[]) => { const v = one(sp[key]); return allowed.includes(v) ? v : ''; };
  const uuidOrEmpty = (key: string) => { const v = one(sp[key]); return /^[0-9a-f-]{36}$/i.test(v) ? v : ''; };
  const filters = {
    status: pick('status', [...Object.keys(OPP_STATUS_LABELS), 'all']), reason: pick('reason', Object.keys(OPP_REASON_LABELS)), seller: manager ? uuidOrEmpty('seller') : '',
    band: pick('band', ['high', 'medium', 'low']), page: parsePage(sp.page),
  };
  const settings = await loadSettings(ctx);
  const [{ rows, total }, people] = await Promise.all([listOpportunities(ctx, filters, settings.priority_high, settings.priority_medium), loadPeople(ctx)]);
  const owners = Object.fromEntries(labelMap(people));
  const params = { status: filters.status, reason: filters.reason, seller: filters.seller, band: filters.band };

  return (
    <>
      <PageHeader title="Reativação" description="Clientes que pedem atenção, em ordem de prioridade. Cada linha explica por que está aqui.">
        {manager ? <RefreshOpportunitiesButton /> : null}
      </PageHeader>
      <div className="mb-4">
        <Alert tone="info">
          Prioridade (0 a 100) = valor histórico do cliente ({settings.w_value}%) + frequência ({settings.w_frequency}%) + atraso em relação ao esperado ({settings.w_overdue}%). Alta a partir de {settings.priority_high}, média a partir de {settings.priority_medium}. Os pesos são configuráveis.
          «Reativado» significa que o cliente comprou <em>depois</em> da identificação (observado); não afirma que o contato causou a compra.
        </Alert>
      </div>

      <ListFilters
        action="/reativacao" q="" search={false}
        selects={[
          { name: 'status', label: 'Situação', value: filters.status, all: 'Abertas e em andamento', options: [...Object.entries(OPP_STATUS_LABELS).map(([value, label]) => ({ value, label })), { value: 'all', label: 'Todas' }] },
          { name: 'reason', label: 'Motivo', value: filters.reason, all: 'Todos', options: Object.entries(OPP_REASON_LABELS).map(([value, label]) => ({ value, label })) },
          { name: 'band', label: 'Prioridade', value: filters.band, all: 'Todas', options: [{ value: 'high', label: 'Alta' }, { value: 'medium', label: 'Média' }, { value: 'low', label: 'Baixa' }] },
          ...(manager ? [{ name: 'seller', label: 'Responsável', value: filters.seller, all: 'Todos', options: personOptions(people) }] : []),
        ]}
      />
      <OpportunitiesTable
        rows={rows} owners={owners} high={settings.priority_high} medium={settings.priority_medium}
        empty={<EmptyState title="Nenhuma oportunidade" description={manager ? 'Clique em «Atualizar análise de risco» depois de importar clientes e compras.' : 'Quando houver clientes em risco na sua carteira, eles aparecem aqui.'}><Link className="underline" href="/clientes">Ver clientes</Link></EmptyState>}
      />
      <Pagination basePath="/reativacao" page={filters.page} total={total} params={params} />
    </>
  );
}
