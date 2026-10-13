# RFM_MODEL — Metodologia RFM e regras de relacionamento

Determinístico, explicável e **sem previsão estatística**: os segmentos descrevem o comportamento passado, não a probabilidade de o cliente sair (churn). Fonte da verdade: funções SQL `pv_rfm_scores`, `pv_rfm_classify`, `pv_rfm_run`; espelho TypeScript `lib/pv/rfm.ts` (simulador de parâmetros), ambos provados com as mesmas fixtures calculadas à mão (`tests/fixtures/rfm-cases.json`).

## Compra válida e valor líquido
- Compra **válida** = `status = 'completed'` **e** valor líquido > 0. Cancelada não conta. Estorno parcial reduz o líquido; estorno total (líquido 0) tira a compra da contagem.
- Valor líquido = `total_cents − refunded_cents`. O total já é o valor do pedido que a empresa quer analisar (informe sem frete/impostos se não quiser que contem). Dinheiro sempre em centavos inteiros.

## Variáveis (na janela de análise e na data de referência)
- **R (recência)** = `data_referência − data da última compra válida` (dias inteiros, no fuso da organização). Considera a última compra válida **na janela**.
- **F (frequência)** = número de compras válidas na janela (pedidos, não itens).
- **M (monetário)** = soma do valor líquido das compras válidas na janela.
- Janela: 90, 180, 365 dias ou personalizada (30 a 1.095). Janela = `(ref − janela, ref]`.

## Quem recebe pontuação
Só clientes com ≥ 1 compra válida **na janela**. Os demais não recebem R/F/M inventados:
- sem nenhuma compra válida na vida → segmento **`sem_compras`**;
- com compras só antes da janela → segmento **`inativos`** (R/F/M ficam vazios).

## Pontuação 1–5 (5 = mais favorável)
**Modo percentil (padrão).** Para cada variável, entre os clientes pontuados: `pr = percent_rank` (0 a 1; empates recebem o mesmo `pr` = mesma nota).
- F e M: `nota = min(5, 1 + floor(pr × 5))`.
- R (menor é melhor): `nota = min(5, 1 + floor((1 − pr_R) × 5))`, onde `pr_R` é o `percent_rank` de R em ordem crescente.
- Com **menos de 5 clientes pontuados** a amostra é pequena: as notas são calculadas, mas marcadas `low_sample` (a tela avisa) e **nenhum alerta é tratado como previsão**.
- Se todos têm o mesmo valor (distribuição concentrada), todos recebem a mesma nota: `pr = 0` ⇒ F/M = 1 e R = 5. Documentado para não surpreender.

**Modo limites fixos.** Limites por organização (`rfm_limits`): `r: [a,b,c,d]` (dias crescentes: R ≤ a → 5, ≤ b → 4, ≤ c → 3, ≤ d → 2, senão 1); `f: [a,b,c,d]` e `m: [a,b,c,d]` (crescentes: valor ≥ d → 5, ≥ c → 4, ≥ b → 3, ≥ a → 2, senão 1).

## Segmentos (primeira regra que servir)
| Ordem | Segmento | Regra |
|---|---|---|
| 1 | `campeoes` Campeões | R ≥ 4, F ≥ 4, M ≥ 4 |
| 2 | `fieis` Fiéis | R ≥ 3, F ≥ 3 |
| 3 | `novos` Novos clientes | F = 1 **e** primeira compra válida há ≤ `new_customer_days` (padrão 30) |
| 4 | `promissores` Promissores | R ≥ 4 |
| 5 | `em_risco` Em risco | R ≤ 2 e (F ≥ 3 ou M ≥ 3) — já foi um bom cliente e está distante |
| 6 | `atencao` Precisam de atenção | demais (R = 3, ou R ≤ 2 com F e M baixos) |
| — | `inativos` | sem compra na janela |
| — | `sem_compras` | nunca comprou |

## Histórico imutável
Cada execução é uma **rodada** (`rfm_runs`): guarda data de referência, janela, modo, limites e todas as notas por cliente. Mudar parâmetros **cria nova rodada**; as anteriores nunca são reescritas. O painel usa a rodada mais recente (ou a escolhida). Executar de novo com os mesmos dados e parâmetros gera notas idênticas (determinístico).

## Estado do relacionamento (ativo / em risco / inativo)
Calculado por `pv_customer_signals` na data de referência, independente da rodada RFM:
- **Inativo:** dias desde a última compra válida ≥ `inactive_days` (padrão 180).
- **Em risco (qualquer regra ativa):**
  1. *Inatividade:* dias sem comprar ≥ `risk_days` (padrão 90) e < `inactive_days`.
  2. *Ciclo de recompra:* ≥ `cycle_min_purchases` (padrão 3) compras válidas, intervalo **mediano** histórico `Md` entre compras consecutivas, e `dias_sem_comprar > cycle_factor × Md` (padrão 1,5) e ≥ `cycle_min_days` (padrão 15). Histórico menor que o mínimo = **dados insuficientes** (não alerta).
  3. *Queda de frequência:* pedidos nos últimos `drop_window_days` (padrão 90) **menores** em ≥ `drop_pct` % (padrão 50) que nos `drop_window_days` anteriores, com ≥ `drop_min_prev` (padrão 2) no período anterior.
  4. *Mudança de segmento:* na rodada atual o cliente caiu de `campeoes`/`fieis` (rodada anterior) para `em_risco`/`atencao`/`inativos`.
- **Ativo:** tem compra válida e nenhuma regra acima.
- **Sem compras:** nunca comprou.
Cada alerta guarda a **explicação** (valores usados). Limites são por organização: não há regra universal.

## Prioridade da oportunidade (0–100, configurável)
`prioridade = round(w_valor × P_M + w_freq × P_F + w_atraso × min(1, atraso))`, com pesos em % (padrão 40/20/40), `P_M` e `P_F` = posição percentual (percent_rank, 0–1) do cliente em valor e frequência históricos, e `atraso = dias_sem_comprar ÷ referência` (referência = `cycle_factor × Md` quando há ciclo; senão `inactive_days`). Faixas: alta ≥ 70, média ≥ 40 (configuráveis). Cliente de alto valor **não** é presumido mais propenso a voltar: a prioridade ordena o esforço comercial, não prevê retorno.
`estimated_value_cents` só é preenchido com ≥ 3 compras válidas e é o **ticket mediano histórico** do cliente (rotulado assim; não é previsão).

## Notas de implementação
- **Percentil em inteiros:** com `n` clientes pontuados e `abaixo` = quantos têm valor menor, F e M valem `min(5, 1 + ⌊5·abaixo ÷ (n−1)⌋)`; R é invertido (`abaixo` entre os de **maior** recência em dias). Empates dividem a mesma posição. `n ≤ 1`: R5/F1/M1. Menos de 5 pontuados = **amostra pequena** (sinalizada na rodada e na tela).
- **Estado × segmento:** o estado (ativo, em risco, inativo, sem compras) vem dos sinais de **hoje** (`pv_customer_signals`); o segmento vem da última **rodada** e pode estar defasado até a próxima. Inativo = dias sem comprar ≥ `inactive_days` (o sinal de inatividade é mantido).
- **Datas:** a compra guarda o dia (meio-dia no fuso da organização). Reativação conta do dia da identificação em diante; resultado de campanha, de um dia posterior ao do primeiro contato (ver `CAMPAIGN_RULES.md`).
- **Testes:** 27 casos à mão em `tests/fixtures/rfm-cases.json` (SQL e TS) + limites exatos em `64_pv_boundaries.sql`.

## Limitações
Pequenas amostras, sazonalidade e mudança de catálogo afetam qualquer RFM. Os segmentos são ferramenta de priorização, não de decisão automática sobre pessoas.
