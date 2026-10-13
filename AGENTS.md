# AGENTS — Pós-Venda e Reativação de Clientes

Sistema 04 do Pack 25 Sistemas IA (pos-venda). O status real vive em MEMORY.md.

## Regras perenes
- Esta pasta é autossuficiente: nada importa de fora dela, sem workspace:*, sem citar outros sistemas.
- Ler MEMORY.md antes de trabalhar; atualizar ao concluir marcos, só com fatos comprovados.
- Toda tabela de negócio tem organization_id + RLS; toda mutação valida sessão, papel e entrada (Zod) no servidor.
- Nunca commitar segredos; service-role key só no servidor (este sistema nem a usa), jamais com prefixo NEXT_PUBLIC_.
- Dados pessoais mínimos; sem PII em logs; sem dados reais de cliente em seed.
- Não declarar pronto sem evidência (comando + resultado). Se algo não foi executado, escrever NÃO EXECUTADO.

## Comandos
pnpm install --frozen-lockfile · pnpm lint · pnpm typecheck · pnpm test · pnpm build · pnpm test:db (Docker) · pnpm test:mutation · pnpm test:e2e (Supabase local + app **recompilado**) · node scripts/gen-fixtures-sql.mjs · node scripts/gen-seed.mjs

## Regras do sistema
- O motor vive no BANCO: notas RFM, segmentos, sinais de risco, oportunidades, elegibilidade de campanha e importação. `lib/pv/rfm.ts` é espelho: mexeu numa regra, atualize `tests/fixtures/rfm-cases.json` (valores à mão), rode `gen-fixtures-sql.mjs` e os dois conjuntos de testes.
- Compra válida = `status='completed'` e líquido > 0. Estado e segmento nunca são digitados: vêm de `pv_customer_signals` e das rodadas `pv_rfm_run` (histórico imutável; nova rodada ACRESCENTA).
- Escreva em estado, oportunidade, resultado de campanha, preferência, supressão e importação só pelas funções `pv_*`. Ausência de preferência NÃO é consentimento; recusa vira supressão.
- Datas de compra guardam o DIA (meio-dia no fuso da organização). Comparações com eventos são por data local (reativação: do dia da identificação em diante; campanha: dia posterior ao 1º contato).
- Nomenclatura honesta: «observado», nunca «incremental» ou «causado». Sem envio de mensagens.
- Segmentos: campos e operadores de lista fechada (`pv_validate_criteria`); nenhum SQL do usuário.
- CSP estrita: sem estilo em linha; gráficos só no navegador. CSV neutraliza fórmulas.
- Mudou uma regra crítica de banco: rode `pnpm test:mutation` (todas as mutações devem morrer; adicione uma nova se criar regra crítica).
- Cuidado: em JS, `String.replace` com `$$` corrompe SQL; use Edit, sed ou função de substituição.

## Definição de pronto (resumo)
Migrações em banco limpo, seed reproduzível, teste RLS A/B negando acesso cruzado, fluxos críticos em Playwright, mobile e desktop revisados, licenças e segredos verificados, instalação isolada validada, docs e MEMORY.md atualizados.
