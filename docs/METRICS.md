# METRICS — Pós-Venda e Reativação de Clientes

Todo número do painel, dos relatórios e dos CSV vem de funções SQL `security invoker` (`20270401000300_pv_metrics.sql`): o RLS já limita ao que cada papel enxerga (vendedor: só a carteira dele). Nenhum número é digitado. Período e «dia» usam o **fuso da organização**; filtros vêm da URL e são validados.

## Vocabulário
- **Compra válida**: concluída e com valor líquido (total − estornos) maior que zero. Cancelamento e estorno total saem de todos os números.
- **Observado**: aconteceu **depois** da identificação ou do contato. **Não** afirma causa nem receita incremental.
- **Dia da compra**: a compra guarda só o dia (meio-dia local). Comparações com eventos são por data local.

## Indicadores do painel (`pv_kpis`)
| Indicador | Fórmula | Observação |
|---|---|---|
| Clientes que compraram | clientes distintos com compra válida no período | filtros: responsável, segmento, situação, categoria |
| Clientes em risco / inativos | estado atual (`pv_customer_signals`) | situação de **agora**, não do período |
| Clientes reativados (observado) | clientes com evento `reactivated` no período | compra válida a partir do dia da identificação |
| Taxa de reativação (observada) | clientes com oportunidade identificada no período **e janela encerrada** que recompraram dentro da janela ÷ clientes da coorte | janelas ainda abertas ficam fora (não subestima); sem coorte = «—» |
| Receita de reativados (observada) | valor líquido das compras que reconheceram a reativação | não é incremental |
| Taxa de recompra | compradores com 2+ pedidos válidos no período ÷ compradores | sem compradores = «—» |
| Receita / pedidos | soma do líquido / contagem das compras válidas | |
| Ticket médio | receita ÷ pedidos, arredondado ao centavo | sem pedidos = «—» |
| Tarefas vencidas | tarefas abertas com prazo no passado | |

Variação «vs período anterior» compara com o período imediatamente anterior de igual duração; base zero = sem variação (nunca inventada).

## Gráficos
Receita (primeira compra × recompra) · ticket médio · clientes por segmento RFM · ativos/risco/inativos · frequência (1, 2, 3–4, 5+) · reativações observadas · retenção por coorte (mês da 1ª compra; exige 2+ coortes) · campanhas (contatados, responderam, recompraram) · reativação por responsável. Cada um traz «Ver dados em tabela».
Granularidade da série: dia (até 62 dias), semana (até 210) ou mês.

## Campanhas (`pv_campaign_stats`, `pv_campaign_series`)
Campanhas «vivas» no período (em andamento/pausadas desde antes; rascunhos e planejadas só se criadas nele; encerradas se terminaram nele ou depois). Contatados = contatos com status diferente de «planejado», por cliente; % de resposta = responderam ÷ contatados. Resultado ver `CAMPAIGN_RULES.md`.

## Alertas (`pv_alerts`)
Tarefas vencidas; oportunidades abertas de prioridade alta; clientes perto do fim do ciclo (80% do limite); oportunidades abertas há mais de 7 dias sem contato.

## Relatórios (12) e CSV
Clientes por situação · segmentos RFM · em risco · inativos · oportunidades · campanhas · contatos · recompra · receita e ticket · coortes · responsáveis · compras do período. CSV: UTF-8 com BOM, `;`, vírgula decimal, fórmulas neutralizadas, até 5.000 linhas, só gestão, cada download na auditoria (`pv_log_export`: quem, qual relatório, quantas linhas; nunca os dados).
