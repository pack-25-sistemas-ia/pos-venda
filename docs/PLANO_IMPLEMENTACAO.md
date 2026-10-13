# PLANO_IMPLEMENTACAO — Pós-Venda e Reativação de Clientes

Fases executadas na ordem abaixo; cada uma terminou com testes verdes antes da seguinte.

| Fase | Entrega | Verificação |
|---|---|---|
| 1. Base | Esquema (clientes, compras, itens, importações, RFM, oportunidades, segmentos, campanhas, preferências, supressão, tarefas, notificações), RLS, grants por coluna, gatilhos, auditoria | `test:db` (Core + 60) |
| 2. Motor RFM | Funções puras (percentil inteiro, limites fixos, classificação), rodada com histórico imutável, espelho TS | Fixtures à mão em SQL e TS (60, `pv-rfm.test.ts`) |
| 3. Risco e oportunidades | Sinais, estado, prioridade, valor estimado, explicação, reativação, segmentos dinâmicos sem SQL livre | `61_pv_engine` |
| 4. Operações | Compras (cancelar/estornar/desfazer), importação com prévia = gravação, preferências, supressão, LGPD, campanhas e resultado observado | `62_pv_operations` |
| 5. Métricas | KPIs, séries, coortes, distribuições, campanhas, alertas, log de exportação | `63_pv_metrics` |
| 6. Mutação | 78 mutações das regras críticas; sobreviventes viraram testes | `64_pv_boundaries`; `test:mutation` |
| 7. Interface | Clientes, compras, assistente de importação, segmentação, reativação, campanhas, tarefas, relatórios, notificações, configurações com simulador | lint, tipos, build |
| 8. Painel e relatórios | 10 KPIs, 9 gráficos, filtros, 12 relatórios com CSV auditado | `pv-demo` |
| 9. Demonstração | Seed gerado (206 clientes, ~1.260 compras, rodadas, histórias de reativação, campanhas, tarefas) | `pv-demo` |
| 10. E2E e segurança | Fluxos, campanha, RLS A/B, MFA, XSS/CSV, LGPD, mobile, capturas revisadas | `pv-*.spec.ts` |
| 11. Entrega | Docs, licenças, CI, instalação isolada, repositório público | CI verde; cópia exportada |

## Riscos tratados
Consentimento presumido (proibido por desenho) · causalidade falsa (linguagem «observado», coorte com janela encerrada) · float em percentis (inteiros) · dependência da hora do dia (datas locais) · SQL livre em segmentos (lista fechada) · vazamento entre carteiras (RLS por responsável) · formulas em CSV (neutralização).

## Fora do escopo
ERP; disparo em massa/WhatsApp automático; previsão de churn por modelo; incrementalidade; RAG; entrevista de onboarding.
