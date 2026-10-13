# CAMPAIGN_RULES — regras de campanha, permissão e resultado

O sistema **não envia mensagens**. Ele monta o público, mostra o texto de apoio e registra o contato feito manualmente pela equipe.

## Permissão de contato (LGPD)
- Por cliente e por canal (telefone, WhatsApp, e-mail): `granted` (consentimento), `legitimate_interest` ou `denied`. Consentimento e legítimo interesse exigem **base legal/referência** escrita.
- **Ausência de registro NÃO é consentimento.** Cliente sem permissão no canal fica fora da campanha (motivo «sem permissão registrada»).
- Registro em lote (`pv_set_preference_bulk`): só gestão, base legal obrigatória, só para quem não tem preferência no canal, nunca sobrescreve escolha do cliente nem alcança arquivados/anonimizados. Vai para a auditoria.
- **Supressão**: por canal ou geral; vale mesmo com permissão. Levantar exige gestão. **Recusa em campanha vira supressão do canal** automaticamente.
- Elegibilidade (`private.pv_eligibility`): arquivado → anonimizado → suprimido → sem permissão → negada → elegível. É reavaliada no **momento do contato**, não só ao montar o público.

## Ciclo da campanha
`rascunho → planejada → em andamento ⇄ pausada → concluída` (ou cancelada). Concluída/cancelada são finais.
1. **Calcular público** (rascunho/planejada): segmento → clientes → elegíveis ou excluídos com motivo; guarda a fotografia da elegibilidade.
2. **Iniciar** exige público calculado; depois disso o público fica **congelado**.
3. **Contato manual** (`pv_campaign_log_contact`): só em campanha em andamento, só para quem está no público e continua elegível. Status: planejado, contatado, respondeu, sem resposta, recusou.
4. **Resultado observado**: compra válida em **dia posterior** ao do primeiro contato registrado e dentro da janela de observação da campanha (padrão 30 dias). Compra do mesmo dia é ambígua (a compra guarda só o dia) e não é contada. Idempotente: sincronizar de novo não duplica.
5. Cancelar/estornar totalmente a compra **desfaz** o resultado, a reativação e o evento.

## Mensagens
Variáveis `{{nome}}`, `{{primeiro_nome}}`, `{{empresa}}`, `{{ultima_compra}}`, `{{dias_sem_comprar}}`, `{{produto}}`, `{{vendedor}}`; valor padrão com `{{nome|cliente}}`. Variável desconhecida é recusada; sem valor e sem padrão fica vazia e a tela avisa. Saída sempre em texto.

## Linguagem
«Recomprou (observado)». Nunca «incremental», «causado» ou «ROI da campanha».
