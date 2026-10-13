import type { Metadata } from 'next';
import { Alert, Card, PageHeader } from '@/components/ui/primitives';
import { FilterBar } from '@/components/app/filter-bar';
import { requireContext } from '@/lib/auth/session';
import { isManager, type SearchParams } from '@/lib/pv/access';
import { listCategories, loadPeople, loadSettings, personOptions } from '@/lib/pv/data';
import { filtersToQuery, parseFilters, todayIn } from '@/lib/pv/filters';
import { formatDate } from '@/lib/pv/format';
import { buildReport, cellText, REPORTS } from '@/lib/pv/reports';

export const metadata: Metadata = { title: 'Relatórios' };

export default async function ReportsPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireContext();
  const sp = await searchParams;
  const settings = await loadSettings(ctx);
  const filters = parseFilters(sp, todayIn(settings.timezone));
  const manager = isManager(ctx.membership.role);
  const [people, categories] = await Promise.all([loadPeople(ctx), listCategories(ctx)]);
  const query = filtersToQuery(filters);
  const reports = await Promise.all(REPORTS.map(async (r) => ({ meta: r, data: await buildReport(ctx, r.key, filters).catch(() => null) })));

  return (
    <>
      <PageHeader title="Relatórios" description={`Período: ${formatDate(filters.from)} a ${formatDate(filters.to)}. Os mesmos números do painel, com download em CSV (separador «;», valores em reais, abre no Excel).`} />
      <FilterBar action="/relatorios" filters={filters} sellers={manager ? personOptions(people) : undefined} categories={categories} />
      {!manager ? <div className="mb-4"><Alert tone="info">Você vê os relatórios dos clientes atribuídos a você. O download em CSV é restrito à gestão.</Alert></div> : null}
      <div className="mb-4"><Alert tone="warning">Os CSV contêm dados pessoais de clientes (nome e empresa). Baixe só o necessário, guarde com cuidado e apague quando não precisar mais. Cada download fica registrado na auditoria (quem, qual relatório e quantas linhas; nunca os dados).</Alert></div>

      <div className="space-y-4">
        {reports.map(({ meta, data }) => (
          <Card key={meta.key} title={meta.title} description={`${meta.description} (${meta.scope})`}>
            {data === null ? <p className="text-sm text-danger">Não foi possível carregar este relatório agora.</p> : (
              <>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-muted">{data.rows.length === 0 ? 'Sem dados com os filtros atuais.' : `${data.rows.length.toLocaleString('pt-BR')} linha(s)${data.truncated ? ' (limitado a 5.000)' : ''}.`}</p>
                  {manager ? <a className="inline-flex min-h-9 items-center rounded-md border border-border px-3 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/5" href={`/export/${meta.key}?${query}`}>Baixar CSV</a> : null}
                </div>
                {data.rows.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[30rem] text-left text-xs">
                      <caption className="sr-only">{meta.title} (primeiras 6 linhas)</caption>
                      <thead className="border-b border-border text-muted"><tr>{data.headers.map((h) => <th key={h} scope="col" className="px-2 py-1 font-medium">{h}</th>)}</tr></thead>
                      <tbody>{data.rows.slice(0, 6).map((r, i) => <tr key={i} className="border-b border-border last:border-0">{r.map((c, k) => <td key={k} className="px-2 py-1 tabular-nums">{cellText(c)}</td>)}</tr>)}</tbody>
                    </table>
                  </div>
                ) : null}
              </>
            )}
          </Card>
        ))}
      </div>
    </>
  );
}
