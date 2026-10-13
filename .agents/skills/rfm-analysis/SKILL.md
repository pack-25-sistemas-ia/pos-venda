---
name: rfm-analysis
description: Use ao alterar notas RFM, segmentos, janela, limites fixos ou a rodada (pv_rfm_run).
---

# RFM

- Fonte da verdade: `pv_rfm_scores` / `pv_rfm_classify` / `pv_score_fixed` (SQL). `lib/pv/rfm.ts` é espelho: mexeu, atualize `tests/fixtures/rfm-cases.json` **com valores calculados à mão**, rode `node scripts/gen-fixtures-sql.mjs`, depois `pnpm test` e `pnpm test:db`.
- Percentil só em **inteiros** (`1 + 5·abaixo/(n−1)` com teto 5; R invertido). Nada de `percent_rank` em float nas bordas.
- Rodadas são imutáveis (gatilho barra UPDATE). Nova rodada acrescenta e gera eventos de mudança de segmento.
- Valida janela 30–1095 dias; menos de 5 pontuados = `low_sample`.
- Documentação: `docs/RFM_MODEL.md`. Mudou regra crítica: `pnpm test:mutation`.
