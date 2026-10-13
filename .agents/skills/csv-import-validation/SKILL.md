---
name: csv-import-validation
description: Use ao alterar o assistente de importação, o mapeamento de colunas, a conversão de valores ou as funções pv_import_*.
---

# Importação CSV

- Fluxo: `parseTable` (limites 2 MB / 2.000 linhas / 60 colunas) → `suggestMapping` por cabeçalho → `buildRows` (R$ `1.234,56`, `DD/MM/AAAA`, status em português) → `pv_import_*` com `p_apply=false` (prévia) e depois `true`. Prévia e gravação **compartilham o código**; a prévia desfaz por exceção `PV001`.
- A conversão de formato é do cliente (`lib/pv/import.ts`); a **validação de verdade** (duplicidade, cliente existente, limites, valores) é do banco. Limite de linhas existe nos dois lados.
- Cabeçalho novo: acrescente o alias em `CUSTOMER_FIELDS`/`PURCHASE_FIELDS` e um caso em `tests/unit/pv-import.test.ts`.
- Importar clientes **nunca** cria permissão de contato. Valor inválido vira linha recusada com mensagem, nunca erro genérico.
- Cuidado: em JS, `replace` com `$$` corrompe SQL.
