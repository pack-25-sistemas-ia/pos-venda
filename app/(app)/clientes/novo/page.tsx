import type { Metadata } from 'next';
import { Card, PageHeader } from '@/components/ui/primitives';
import { CustomerForm } from '@/components/pv/customer-forms';
import { requireContext } from '@/lib/auth/session';
import { WRITER_ROLES } from '@/lib/pv/access';

export const metadata: Metadata = { title: 'Novo cliente' };

export default async function NewCustomerPage() {
  await requireContext(WRITER_ROLES);
  return (
    <>
      <PageHeader title="Novo cliente" description="Cadastre manualmente. Para trazer a sua base, use «Importar CSV» na lista de clientes." />
      <Card><CustomerForm /></Card>
    </>
  );
}
