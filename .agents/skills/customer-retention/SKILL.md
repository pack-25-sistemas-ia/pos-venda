---
name: customer-retention
description: Use ao mexer em risco de cliente, oportunidades de reativação, prioridade ou no fluxo de contato com clientes que esfriaram.
---

# Retenção e reativação

- Estado do cliente = `pv_customer_signals(org, data)` (inatividade, ciclo, queda). Nunca grave estado à mão; nunca copie a regra para o TypeScript.
- Oportunidade nasce em `pv_refresh`, tem prioridade (pesos configuráveis), valor estimado só com 3+ compras (ticket mediano, rótulo «referência») e `explanation_json` legível. Trabalhada (em andamento) não é descartada sozinha.
- Reativação = compra válida a partir do **dia** da identificação (data local). Cancelar/estornar totalmente desfaz (função `pv_unwind_purchase`).
- Linguagem: «observado». Proibido: «incremental», «causado», «prevê churn».
- Regra nova de risco: coluna em `pv_settings`, bloco em `pv_customer_signals`, teste de limite exato em `64_pv_boundaries.sql` e mutação em `mutation-check.mjs`.
