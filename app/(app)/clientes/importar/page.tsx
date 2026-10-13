import type { Metadata } from 'next';
import { Alert, PageHeader } from '@/components/ui/primitives';
import { ImportWizard } from '@/components/pv/import-wizard';
import { requireContext } from '@/lib/auth/session';
import { MANAGER_ROLES } from '@/lib/pv/access';
import { listImportJobs } from '@/lib/pv/data';

export const metadata: Metadata = { title: 'Importar clientes' };

export default async function ImportCustomersPage() {
  const ctx = await requireContext(MANAGER_ROLES);
  const jobs = (await listImportJobs(ctx, 30)).filter((j) => j.kind === 'customers').slice(0, 8);
  return (
    <>
      <PageHeader title="Importar clientes" description="Traga sua base por CSV. Clientes com o mesmo e-mail, CPF/CNPJ ou identificador não são duplicados." />
      <div className="mb-4"><Alert tone="info">Importar não registra consentimento para contato. {/* download de arquivo (rota de API), não navegação de página */}<a className="underline" href="/export/modelo-clientes" download>Baixar modelo de CSV</a>. A permissão de cada cliente por canal é registrada na ficha do cliente (ou em lote, com a base legal, em «Campanhas»).</Alert></div>
      <ImportWizard kind="customers" doneHref="/clientes" doneLabel="Ver clientes" history={jobs} />
    </>
  );
}
