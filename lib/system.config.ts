// Configuração do Pós-Venda e Reativação de Clientes. Para personalizar para um cliente:
//  1. troque `name`;  2. substitua public/brand/logo.svg;  3. ajuste a navegação em `primaryNav`.
// Este arquivo é do sistema (listado em .core-overrides): o sync-core nunca o sobrescreve.
import type { OrgRole } from '@/lib/validation/org';

export type NavItem = { href: string; label: string; roles?: readonly OrgRole[] };

export const systemConfig: { name: string; logo: string; primaryNav: NavItem[] } = {
  name: 'Pós-Venda e Reativação',
  logo: '/brand/logo.svg',
  primaryNav: [
    { href: '/dashboard', label: 'Painel' },
    { href: '/clientes', label: 'Clientes' },
    { href: '/compras', label: 'Compras' },
    { href: '/segmentacao', label: 'Segmentação (RFM)' },
    { href: '/reativacao', label: 'Reativação' },
    { href: '/campanhas', label: 'Campanhas' },
    { href: '/atividades', label: 'Tarefas' },
    { href: '/relatorios', label: 'Relatórios' },
    { href: '/notificacoes', label: 'Notificações' },
    { href: '/configuracoes', label: 'Configurações comerciais', roles: ['owner', 'admin'] },
  ],
};
