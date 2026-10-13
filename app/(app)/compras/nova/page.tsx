import type { Metadata } from 'next';
import { Card, PageHeader } from '@/components/ui/primitives';
import { PurchaseForm } from '@/components/pv/customer-forms';
import { requireContext } from '@/lib/auth/session';
import { one, WRITER_ROLES, type SearchParams } from '@/lib/pv/access';
import { customerOptions, loadSettings } from '@/lib/pv/data';
import { todayIn } from '@/lib/pv/filters';

export const metadata: Metadata = { title: 'Nova compra' };

export default async function NewPurchasePage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireContext(WRITER_ROLES);
  const sp = await searchParams;
  const fixed = /^[0-9a-f-]{36}$/i.test(one(sp.cliente)) ? one(sp.cliente) : undefined;
  const [customers, settings] = await Promise.all([customerOptions(ctx), loadSettings(ctx)]);
  return (
    <>
      <PageHeader title="Nova compra" description="Registre uma compra concluída. Estornos e cancelamentos são feitos depois, na ficha do cliente." />
      <Card><PurchaseForm customers={customers} fixedCustomer={fixed && customers.some((c) => c.value === fixed) ? fixed : undefined} today={todayIn(settings.timezone)} /></Card>
    </>
  );
}
