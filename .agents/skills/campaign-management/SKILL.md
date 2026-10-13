---
name: campaign-management
description: Use ao criar ou alterar campanhas, público, permissão de contato, supressão, mensagens ou resultados de campanha.
---

# Campanhas

- Contato é **manual**; o sistema não envia nada. Texto de apoio com variáveis (`lib/pv/templates.ts`).
- Elegibilidade (`private.pv_eligibility`): arquivado → anonimizado → suprimido → sem permissão → negada. **Ausência de preferência não é consentimento.** Recusa vira supressão. Reavaliar no momento do contato.
- Público é calculado em rascunho/planejada e **congelado** ao iniciar. Contato só com campanha em andamento e cliente no público.
- Resultado observado: compra válida em dia posterior ao do 1º contato, dentro da janela (padrão 30 dias). Idempotente; estorno/cancelamento desfaz.
- Mudou regra: teste em `62_pv_operations.sql`/`64_pv_boundaries.sql`, mutação nova, `docs/CAMPAIGN_RULES.md`.
