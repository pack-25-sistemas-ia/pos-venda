import type { Metadata } from 'next';
import { Alert, PageHeader } from '@/components/ui/primitives';
import { ImportWizard } from '@/components/pv/import-wizard';
import { requireContext } from '@/lib/auth/session';
import { MANAGER_ROLES } from '@/lib/pv/access';
import { listImportJobs } from '@/lib/pv/data';

export const metadata: Metadata = { title: 'Importar compras' };

export default async function ImportPurchasesPage() {
  const ctx = await requireContext(MANAGER_ROLES);
  const jobs = (await listImportJobs(ctx, 30)).filter((j) => j.kind === 'purchases').slice(0, 8);
  return (
    <>
      <PageHeader title="Importar compras" description="Uma linha por compra (ou por item, repetindo o número do pedido). Pedidos já cadastrados são ignorados." />
      <div className="mb-4"><Alert tone="info">Valores em reais (ex.: 1.234,56) e datas em DD/MM/AAAA são convertidos automaticamente. A hora da compra é ignorada: vale o dia, no fuso da organização. Importe os clientes antes, ou marque a opção de cadastrar clientes ausentes. {/* download de arquivo (rota de API), não navegação de página */}<a className="underline" href="/export/modelo-compras" download>Baixar modelo de CSV</a>.</Alert></div>
      <ImportWizard kind="purchases" doneHref="/compras" doneLabel="Ver compras" history={jobs} />
    </>
  );
}
