# OPEN_SOURCE_AUDIT — Pós-Venda e Reativação de Clientes

Consulta de 2026-10-13 (API do GitHub e `npm view`). «Incorporado» = código copiado para este repositório. Dependências instaladas aparecem em `THIRD_PARTY_NOTICES.md` do Pack.

## Matriz de referências

| Projeto | Licença | Atividade | Tecnologia | Decisão |
|---|---|---|---|---|
| Atomic CRM (marmelab) | MIT | 2026-10-12 | React + Supabase | **Referência** de UX (lista, ficha, tarefas); nada copiado |
| Twenty CRM | **AGPL-3.0** (o GitHub exibe NOASSERTION por arquivos mistos) | 2026-10-13 | TypeScript, NestJS | **Só inspiração** de segmentos/visões. **Nenhum código incorporado** |
| Metabase | **AGPL-3.0** (núcleo; NOASSERTION no GitHub) | 2026-10-13 | Clojure | **Não utilizado**: BI genérico; as métricas aqui são funções SQL com definições próprias |
| Mautic | GPL-3.0 | 2026-10-12 | PHP | **Só inspiração** de segmentos e supressão. Nenhum código incorporado; automação de envio está fora do escopo |
| Odoo (Community) | LGPL-3.0 | 2026-10-13 | Python | **Não utilizado** (ERP completo está fora do escopo) |
| erxes | licença própria/AGPL (NOASSERTION) | 2026-10-12 | TypeScript | **Não utilizado** |
| Papa Parse | MIT | 2026-10-09 | JS | **Usar** (leitura de CSV com limites) |
| Recharts | MIT | 2026-10-13 | React | **Usar** (gráficos, só no navegador) |
| TanStack Table | MIT | 2026-10-12 | React | **Usar** (tabelas ordenáveis) |
| react-hook-form + resolvers | MIT | — | React | **Usar** (formulários, mesmo esquema Zod do servidor) |

RFM é uma técnica de domínio público (recência, frequência, valor); a implementação aqui é própria, determinística e testada com fixtures calculadas à mão (`docs/RFM_MODEL.md`). Nenhuma biblioteca de RFM/«churn» foi adotada: modelos estatísticos ou de aprendizado de máquina estão fora do escopo e o resultado precisa ser explicável linha a linha.

## Riscos observados
- **Licenças copyleft de rede (AGPL)** em CRMs/BI abertos populares: incompatíveis com a distribuição pretendida; nada incorporado.
- **Motores de segmentação em JavaScript** não rodam no PostgreSQL; aqui os critérios são dados (`criteria_json`) interpretados por uma função SQL com lista fechada de campos e operadores (D-6).
- **Estilos em linha** de bibliotecas de gráfico/tabela: bloqueados pela CSP estrita; gráficos carregam só no navegador.

## Dependências adicionadas por este sistema (sobre o Core)
| Pacote | Versão | Licença | Uso |
|---|---|---|---|
| recharts | 3.10.1 | MIT | gráficos do painel |
| react-hook-form + @hookform/resolvers | 7.89.0 / 5.9.1 | MIT | formulários |
| @tanstack/react-table | 8.21.3 | MIT | tabelas |
| papaparse | 5.7.0 | MIT | leitura de CSV (assistente de importação) |

Arquivos de terceiros incorporados a este repositório: **nenhum**.
