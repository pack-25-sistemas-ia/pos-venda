# ARCHITECTURE — Pós-Venda e Reativação de Clientes

```
Navegador ── Next.js (Server Components + Server Actions + route handlers)
                │  sessão + papel + Zod no servidor (lib/pv/actions.ts)
                ▼
          Supabase (Auth + PostgREST + Postgres)
                │  RLS por organização/carteira; escrita sensível em funções SECURITY DEFINER
                ▼
          Motor (SQL): sinais · RFM · oportunidades · segmentos · elegibilidade · importação · métricas
```
O app **não usa `service_role`**: tudo roda como o usuário, limitado pelo RLS e pelas funções.

## Camadas
- `supabase/migrations`: fonte da verdade das regras. `lib/pv/rfm.ts` é espelho (simulador de configurações) validado pelas mesmas fixtures calculadas à mão.
- `lib/pv/data.ts` (leitura), `actions.ts` (escrita via RPC/tabelas com grants), `dashboard.ts` e `reports.ts` (indicadores e relatórios sobre as funções SQL), `validation.ts` (Zod, o mesmo no cliente e no servidor), `import.ts`/`csv.ts` (conversão BR e leitura limitada), `segments.ts`, `templates.ts`, `filters.ts`, `format.ts`.
- `app/(app)/*`: clientes, compras, segmentacao, reativacao, campanhas, atividades, relatorios, notificacoes, configuracoes, export/[kind] (CSV só gestão, auditado), dashboard. `components/pv/*`: formulários, assistente de importação, construtor de segmentos, gráficos (Recharts, só no navegador).
- Core compartilhado (autenticação, MFA, organizações, auditoria, LGPD, tema, CSP) sincronizado por `scripts/sync-core`.

## Segurança em camadas
RLS e grants por coluna · funções com MFA · CSP com nonce e sem estilo em linha · cabeçalhos estritos · CSV com neutralização de fórmula · limites de importação no cliente **e** no banco · mensagens de erro do banco filtradas · nenhum segredo no navegador (E2E varre os pacotes).

## Fluxo da importação
Arquivo → leitura no navegador (limites 2 MB / 2.000 linhas / 60 colunas) → mapeamento sugerido por cabeçalho → conversão (R$, DD/MM/AAAA, status) → `pv_import_*` com `p_apply=false` (prévia por exceção) → `p_apply=true` na mesma lógica. Hash do arquivo avisa reenvio; pedidos e clientes repetidos viram duplicados.
