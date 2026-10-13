'use client';

import dynamic from 'next/dynamic';

// Gráficos só no navegador: a biblioteca gera estilos em linha, que a CSP estrita bloquearia no HTML do servidor.
// Cada gráfico traz uma tabela alternativa acessível, e este esqueleto aparece enquanto carrega.
// (O Next exige que as opções do `dynamic` sejam um objeto literal, por isso se repetem.)
function Skeleton() {
  return (
    <div role="status" className="h-[330px] animate-pulse rounded-lg bg-black/10 dark:bg-white/10">
      <span className="sr-only">Carregando gráfico…</span>
    </div>
  );
}

export const RevenueChartClient = dynamic(() => import('./charts').then((m) => m.RevenueChart), { ssr: false, loading: Skeleton });
export const TicketChartClient = dynamic(() => import('./charts').then((m) => m.TicketChart), { ssr: false, loading: Skeleton });
export const SegmentChartClient = dynamic(() => import('./charts').then((m) => m.SegmentChart), { ssr: false, loading: Skeleton });
export const StateChartClient = dynamic(() => import('./charts').then((m) => m.StateChart), { ssr: false, loading: Skeleton });
export const FrequencyChartClient = dynamic(() => import('./charts').then((m) => m.FrequencyChart), { ssr: false, loading: Skeleton });
export const ReactivationChartClient = dynamic(() => import('./charts').then((m) => m.ReactivationChart), { ssr: false, loading: Skeleton });
export const CohortChartClient = dynamic(() => import('./charts').then((m) => m.CohortChart), { ssr: false, loading: Skeleton });
export const CampaignChartClient = dynamic(() => import('./charts').then((m) => m.CampaignChart), { ssr: false, loading: Skeleton });
export const SellerChartClient = dynamic(() => import('./charts').then((m) => m.SellerChart), { ssr: false, loading: Skeleton });
