# MEMORY — PÓS-VENDA E REATIVAÇÃO DE CLIENTES
Atualizado em: 2026-10-13 | Versão: 0.1.0 | Estado: VALIDADO

## Missão do sistema
Mostrar quem compra, quem esfria e quem sumiu (RFM + regras de risco explicáveis) e organizar o contato manual de reativação com respeito à permissão de contato. Público: lojas, distribuidoras e serviços com clientes recorrentes.

## Stack e caminhos-chave
Next.js 16 (App Router, `proxy.ts`) + TypeScript strict + Tailwind 4 + Supabase (Auth, Postgres/RLS). Raiz do Core (sem `src/`). Banco: `supabase/migrations` (4 do sistema: schema, engine, operations, metrics), testes SQL em `supabase/tests` (60–64). Libs: `lib/pv/*`; componentes: `components/pv/*`.
Comandos: `pnpm lint | typecheck | test | build | test:db | test:mutation | test:e2e`; `node scripts/gen-fixtures-sql.mjs`; `node scripts/gen-seed.mjs`.

## Escopo entregue
Clientes/compras com importação CSV (assistente); RFM em SQL+TS com histórico imutável; sinais de risco (inatividade, ciclo, queda, mudança de segmento); oportunidades com prioridade e explicação; segmentos dinâmicos sem SQL livre; campanhas manuais com permissão/supressão e resultado observado; tarefas; notificações; painel (10 KPIs, 9 gráficos); 12 relatórios com CSV auditado; LGPD; seed de 206 clientes e ~1.260 compras fictícios.
Fora do escopo: ERP, disparo em massa/WhatsApp automático, previsão de churn por modelo, incrementalidade, RAG, onboarding por entrevista.

## Implementado e verificado (evidência em docs/FEATURES.md)
- Banco: 5 arquivos de teste SQL do sistema (fixtures RFM à mão, motor, operações, métricas, limites) e **78 mutações** reprovadas pela suíte.
- Unitários: RFM (fixtures), importação BR, modelos de mensagem, filtros, segmentos, CSV.
- E2E (Supabase local + build de produção): 35 testes (core 13, demo 7, fluxos 4, campanha 2, segurança 7, mobile 2), também na cópia exportada.
- Instalação isolada validada (cópia exportada: install, lint, tipos, unit, build, test:db, E2E). CI do hub: jobs do 04 verdes.

## Pendências e riscos
- Cohort e rótulos de mês dependem do calendário; E2E não afirma números de coorte.
- Demo: números do painel dependem de a base ter sido semeada no mesmo dia (datas relativas a hoje).
- Importação limitada a 2.000 linhas / 2 MB por arquivo (dividir arquivos maiores).
- Listas de clientes carregam até 5.000 registros por tela (estado/segmento calculados à parte).
- Filtro de campanha no painel geral não existe: a visão de campanhas é o próprio painel de campanhas.

## Decisões relevantes (docs/DECISIONS.md)
D-1 motor no banco com espelho TS · D-2 compra guarda o dia; comparação por data local · D-3 ausência de preferência não é consentimento · D-4 sem envio de mensagens · D-5 «observado», nunca causal · D-6 segmentos sem SQL livre · D-7 sem fila pg-boss (refresh sob demanda) · D-8 sem `src/` (raiz do Core).

## Armadilhas aprendidas
- `$$` em JS `replace` vira `$`: corrompe SQL. Use Edit/sed.
- `now()` constante na transação de teste: datas de teste usam dias.
- Aritmética de percentil em inteiros (float erra nas bordas).
- Funções exportadas de arquivo `'use client'` não podem ser chamadas em Server Components.
- Rode `pnpm build` antes do E2E ao mudar código; use porta própria (3114) e o Supabase 583xx deste projeto.

## Próxima tarefa recomendada
Personalizar para o cliente: limites de risco, pesos de prioridade, modelos de mensagem e base legal por canal.
