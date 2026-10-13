---
name: analytics-dashboard
description: Use ao criar ou alterar indicadores, gráficos, filtros, relatórios ou CSV.
---

# Painel e relatórios

- Todo número vem de função SQL `security invoker` em `…_pv_metrics.sql`; definições em `docs/METRICS.md`. Período e «dia» no fuso da organização.
- Novo indicador: função SQL + teste à mão em `supabase/tests/63_pv_metrics.sql` (inclua bordas de fuso/período) + linha em METRICS.md + (se for do painel) E2E comparando a tela com a chamada à função.
- Cuidado clássico: `greatest(0, NULL)` = 0. Taxa sem base é «—», nunca 0%. Taxa de reativação usa coorte com janela encerrada.
- Gráficos: Recharts só no navegador (`charts-loader`), cada um com «Ver dados em tabela». Cor + texto, nunca só cor. Eixo de dinheiro com largura suficiente.
- CSV: `lib/pv/csv.ts` neutraliza fórmulas, UTF-8 com BOM, `;`, só gestão, auditado por `pv_log_export`.
- Filtros vêm da URL e são SEMPRE validados (`lib/pv/filters.ts`).
- Nomenclatura: «observado». Nunca «incremental».
