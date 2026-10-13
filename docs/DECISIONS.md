# DECISIONS — Pós-Venda e Reativação de Clientes

Registro de decisões do sistema (as do Pack estão em `docs/DECISIONS.md` do hub).

**D-1 Motor no banco, espelho em TypeScript.**
Notas RFM, segmentos, sinais de risco, oportunidades, elegibilidade e importação rodam em PostgreSQL (funções `SECURITY DEFINER`/`INVOKER`), onde estão os dados e o RLS. `lib/pv/rfm.ts` espelha o cálculo para o simulador de configurações e passa nas mesmas fixtures calculadas à mão. Percentil em **aritmética inteira** (ponto flutuante errava nas bordas).

**D-2 A compra guarda o DIA; comparações por data local.**
Importações não trazem hora. Reativação vale do dia da identificação em diante (quem já comprou naquele dia nem teria sido identificado); resultado de campanha exige dia **posterior** ao do primeiro contato (compra do mesmo dia é ambígua e não é contada). Torna o resultado independente da hora em que se roda a análise.

**D-3 Ausência de preferência não é consentimento.**
Só `granted` ou `legitimate_interest` (com base legal escrita) e sem supressão entram em campanha. Recusa vira supressão. A elegibilidade é reavaliada no contato. Importar clientes nunca cria permissão.

**D-4 O sistema não envia mensagens.**
Contato manual: o texto é de apoio (copiar). Evita risco de disparo em massa, reputação de número e a necessidade de provedores. Fora do escopo declarado.

**D-5 «Observado», nunca «causal».**
Reativação e recompra de campanha mostram o que aconteceu depois. Sem receita incremental, sem grupo de controle, sem ROI. Taxa de reativação usa coorte com janela **encerrada**.

**D-6 Segmentos dinâmicos sem SQL livre.**
Critérios são dados (`match` + condições de lista fechada). Validação em SQL (`pv_validate_criteria`) e gatilho; valores tipados e escapados com `format(%L)`; o vendedor só alcança a própria carteira (função `INVOKER`).

**D-7 Atualização sob demanda, sem fila.**
`pv_refresh` e `pv_rfm_run` são acionados por botão (gestão) e por importações/compras (reconhecimento de reativação). Sem pg-boss/cron obrigatório: o implantador pode agendar `pv_refresh` se quiser. Menos peças móveis para o comprador.

**D-8 Sem `src/`.** O sistema usa a raiz do Core (`app/`, `components/`, `lib/`), como os demais.

**D-9 Importação: prévia e gravação no mesmo código.** A prévia executa tudo e desfaz por exceção: o que o usuário vê é o que será gravado. Limite de 2.000 linhas/2 MB (cliente e banco).

**D-10 Estado e segmento são conceitos separados.** Estado (ativo/risco/inativo) vem dos sinais **de hoje**; segmento vem da última **rodada** RFM (pode ser mais antigo). Mudança de segmento entre rodadas gera evento e, para Campeões/Fiéis que caíram, oportunidade explicada.

**D-11 Fuso por organização** em todos os períodos; filtros inválidos caem no padrão sem erro.

**D-12 Exportações auditadas.** CSV só para gestão, com registro (quem, relatório, linhas) no `audit_log`, sem os dados.
