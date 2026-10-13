# FEATURES — Pós-Venda e Reativação de Clientes

Estados: VERIFIED (com evidência), BLOQUEADO (exige algo externo) ou NÃO EXECUTADO. Evidências: `tests/e2e/`, `tests/unit/`, `supabase/tests/`.
Siglas: **DEMO** `pv-demo.spec.ts` · **FLOW** `pv-flow.spec.ts` · **CAMP** `pv-campaign.spec.ts` · **SEC** `pv-security.spec.ts` · **MOB** `pv-mobile.spec.ts` · **RFM** `pv-rfm.test.ts` · **IMP** `pv-import.test.ts` · **TPL** `pv-templates-filters.test.ts` · **SEG** `pv-segments.test.ts` · **DB60–64** testes de banco · **MUT** `mutation-check.mjs` (78 mutações).

| Fluxo | Status | Evidência |
|---|---|---|
| Autenticação, organização, papéis, MFA, recuperação de senha | VERIFIED | Core: `core-flow`, `email-flows`, `security` |
| Cadastro de cliente (normalização, duplicidade por e-mail/documento/identificador) | VERIFIED | FLOW; DB62 |
| Compra manual (itens, duplicidade avisada, estorno parcial, cancelamento) | VERIFIED | FLOW; DB62; MUT |
| Importação de clientes e compras por assistente (mapeamento, R$ e datas BR, prévia sem gravar, duplicados, reenvio) | VERIFIED | FLOW; IMP; DB62 |
| Limites de importação (2.000 linhas, 2 MB, estrutura) no cliente e no banco | VERIFIED | SEC; DB64 |
| RFM: percentis em inteiros, limites fixos, janela, histórico imutável, amostra pequena | VERIFIED | RFM; DB60 (fixtures à mão); DB64; MUT |
| 7 segmentos + inativos/sem compras, regras de classificação | VERIFIED | RFM; DB60/61; DB64 |
| Sinais de risco: inatividade, ciclo, queda de frequência (limites exatos, regra desligável) | VERIFIED | DB61; DB64; MUT |
| Oportunidades: prioridade (pesos), valor estimado (≥3 compras), explicação, ações, descarte com motivo | VERIFIED | FLOW; DEMO; DB61 |
| Reativação reconhecida sozinha; estorno/cancelamento a desfazem | VERIFIED | FLOW; DB62; DB64; MUT |
| Segmentos dinâmicos sem SQL livre | VERIFIED | FLOW; SEG; DB61 |
| Campanha: público, elegibilidade por permissão, supressão, contato manual, resultado observado | VERIFIED | CAMP; DB62; DB64; MUT |
| Permissão em lote com base legal; recusa vira supressão | VERIFIED | CAMP; DB62 |
| Mensagens com variáveis e valor padrão | VERIFIED | TPL; CAMP |
| Tarefas e notificações internas | VERIFIED | FLOW; DEMO; DB62 |
| Painel: 10 indicadores, 9 gráficos com tabela alternativa, filtros, variação, alertas | VERIFIED | DEMO; DB63 |
| Taxa de reativação observada (coorte com janela encerrada) | VERIFIED | DB63; DEMO; MUT |
| 12 relatórios e CSV seguro (BOM, `;`, fórmulas neutralizadas), só gestão, auditado | VERIFIED | DEMO; SEC; DB63 |
| Permissões: vendedor só a carteira dele; leitor só lê; sem funções de gestão | VERIFIED | SEC; DEMO; DB62 |
| Isolamento entre organizações (tabelas, funções, indicadores) | VERIFIED | SEC; DB62/63 |
| MFA exigido no banco para escritas de administradores | VERIFIED | SEC |
| LGPD: anonimização, sem permissão após anonimizar, exportação sem dado antigo | VERIFIED | SEC; DB62 |
| XSS e injeção de fórmula; nenhum segredo no navegador | VERIFIED | SEC |
| CSP sem violações nas páginas | VERIFIED | DEMO; Core `security` |
| Mobile (390×844) sem rolagem lateral; alvos de toque ≥ 40 px | VERIFIED | MOB |
| Demonstração: 206 clientes, ~1.260 compras, 2 rodadas RFM, histórias de reativação, 3 campanhas | VERIFIED | DEMO |
| Envio automático de mensagens, previsão de churn, incrementalidade | FORA DO ESCOPO | — |
