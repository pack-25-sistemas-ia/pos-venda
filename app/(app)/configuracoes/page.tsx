import type { Metadata } from 'next';
import { PageHeader } from '@/components/ui/primitives';
import { SettingsForm, toInput } from '@/components/pv/settings-form';
import { requireContext } from '@/lib/auth/session';
import { ADMIN_ROLES } from '@/lib/pv/access';
import { loadSettings } from '@/lib/pv/data';

export const metadata: Metadata = { title: 'Configurações comerciais' };

export default async function CommercialSettingsPage() {
  const ctx = await requireContext(ADMIN_ROLES);
  const settings = await loadSettings(ctx);
  return (
    <>
      <PageHeader title="Configurações comerciais" description="Janela e método do RFM, regras de risco, prioridade das oportunidades e fuso horário. Equipe, privacidade e auditoria ficam nos itens comuns do menu." />
      <SettingsForm initial={toInput(settings)} />
    </>
  );
}
