# DATABASE — Pós-Venda e Reativação de Clientes

Migrações do sistema (sobre as do Core): `20270401000000_pv_schema.sql` (tabelas, RLS, grants, gatilhos), `…100_pv_engine.sql` (RFM, sinais, oportunidades, segmentos), `…200_pv_operations.sql` (compras, importação, preferências, campanhas), `…300_pv_metrics.sql` (indicadores).

## Tabelas
| Grupo | Tabelas |
|---|---|
| Base | `customers`, `purchases` (colunas geradas `net_cents`, `is_valid`), `purchase_items` |
| Importação | `import_jobs`, `import_row_errors` |
| RFM | `rfm_runs`, `customer_rfm_scores` (imutáveis) |
| Ciclo de vida | `customer_lifecycle_events` (chave de evento única), `reactivation_opportunities` |
| Segmentos | `segment_definitions`, `segment_memberships` |
| Campanhas | `campaigns`, `campaign_memberships`, `campaign_contacts`, `campaign_outcomes`, `message_templates` |
| Contato | `communication_preferences`, `suppression_entries` |
| Operação | `customer_activities`, `notifications`, `pv_settings` |

## Princípios
- Toda tabela tem `organization_id`, RLS, chave `(id, organization_id)` nas referências e `grant` mínimo **por coluna**.
- **Papéis**: owner/admin/gestor leem e escrevem tudo; vendedor (`member`) só os clientes atribuídos a ele (e tabelas filhas via `pv_cust_visible/writable`); leitor só lê. Escritas diretas também exigem MFA (políticas restritivas do Core).
- **Escrita sensível só por função `security definer`** (`set search_path = ''`, papel e MFA checados dentro): compras (criar/cancelar/estornar), importações, atribuição, anonimização, preferências, supressão, status de campanha, contatos, rodadas RFM, análise de risco, ações de oportunidade, atualização de segmentos, log de exportação.
- **Histórico imutável**: `rfm_runs` e `customer_rfm_scores` rejeitam UPDATE; `audit_log` é append-only (Core).
- Função pública (`anon`): **nenhuma**.

## Funções principais
`pv_customer_signals(org, data)` estado e sinais por cliente · `pv_rfm_scores/classify/score_fixed` puras · `pv_rfm_run` · `pv_refresh` (oportunidades, eventos, resultados, avisos) · `pv_opp_action` · `pv_validate_criteria` + `pv_segment_members` (segmentos sem SQL livre: valores tipados e escapados) · `pv_import_customers/purchases` (prévia e gravação no mesmo código; a prévia desfaz por exceção) · `pv_campaign_snapshot/set_status/log_contact` · `pv_kpis`, `pv_series`, `pv_cohorts`… (ver METRICS.md).

## Testes de banco
`60_pv_rfm_fixtures` (gerado das fixtures à mão), `61_pv_engine`, `62_pv_operations`, `63_pv_metrics`, `64_pv_boundaries`; mutação em `scripts/mutation-check.mjs` (78 mutações).
