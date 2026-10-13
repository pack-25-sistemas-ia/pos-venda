---
name: supabase-security
description: Use ao criar tabela, função, política, privilégio ou rota deste sistema.
---

# Segurança do banco

- Toda tabela: `organization_id`, RLS, chave composta `(id, organization_id)` nas referências, `revoke all` e `grant` mínimo por coluna.
- Escrita sensível só por função `security definer` com `set search_path = ''`, papel e MFA checados dentro. Este sistema não tem função pública (`anon`).
- Vendedor (`member`) só enxerga/edita clientes atribuídos a ele (`private.pv_can_read/write`, e `pv_cust_visible/writable` nas tabelas filhas). Leitor só lê. Funções de métricas são `security invoker`.
- Histórico RFM e auditoria são imutáveis. Não use `upsert` onde há colunas protegidas.
- Nenhum segredo no git nem no navegador; E2E varre os pacotes de JS procurando `service_role`.
- Teste cada regra nova com RLS A/B e mutação (`pnpm test:mutation`).
- Armadilha: `String.replace` do JS com `$$` corrompe SQL; edite migrações com Edit/sed.
