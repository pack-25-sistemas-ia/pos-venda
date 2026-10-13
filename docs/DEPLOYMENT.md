# DEPLOYMENT — Pós-Venda e Reativação de Clientes

Tudo é seu: seu projeto Supabase, seu repositório, sua hospedagem. Nada é enviado ao autor do Pack.

## Pré-requisitos
Node 22+, pnpm, Docker (só para o Supabase local), conta Supabase (região **São Paulo** para dados pessoais) e hospedagem Node (ex.: Vercel).

## Variáveis (`.env.local`, nunca no git)
| Variável | Valor |
|---|---|
| `NEXT_PUBLIC_APP_URL` | URL pública do app |
| `NEXT_PUBLIC_SUPABASE_URL` | URL do seu projeto Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | chave publishable/anon (segura no navegador, limitada pelo RLS) |

O app **não usa** `service_role`. Não a coloque em variável alguma.

## Banco
1. Local: `supabase start` e `supabase db reset` (migrações + `seed.sql` fictício).
2. Produção: `supabase link --project-ref <ref>` e `supabase db push`. **Não** aplique `seed.sql` em produção (cria usuários de demonstração).
3. No Supabase: confirmação de e-mail, senha mínima de 12, TOTP, **SMTP próprio** e a URL do app em Redirect URLs. Modelos em `supabase/templates`.
4. Teste de banco: `pnpm test:db` (Docker). Mutação: `pnpm test:mutation`.

## Aplicação
`pnpm install --frozen-lockfile` → `pnpm lint && pnpm typecheck && pnpm test && pnpm build` → `pnpm start`. E2E: `pnpm test:e2e` (Supabase local com Mailpit e app rodando). Refaça o `build` antes do E2E depois de mudar o código.
**Windows:** use um caminho curto para a pasta (caminho longo quebra o Vitest/Vite).

## Dados de demonstração
Senha local única `DemoLocal#2026`: `dono@`, `gerente@`, `vendedor1@`, `vendedor2@`, `leitor@` `demo.exemplo`. O proprietário cadastra a verificação em duas etapas no primeiro acesso. As datas são relativas ao dia em que o seed foi aplicado: os números do painel de demonstração valem para uma base recém-semeada. Para regerar: `node scripts/gen-seed.mjs`. Em implantação real, remova a organização «Distribuidora Demonstração».

## Primeiro uso real
Crie sua conta e a organização → Configurações comerciais (fuso, janela do RFM, regras de risco, pesos) → Clientes → Importar CSV → Compras → Importar CSV → Segmentação → Calcular rodada RFM → Reativação → Atualizar análise de risco → registre a **permissão de contato** (ficha do cliente ou em lote com a base legal) → Campanhas.

## Rotina sugerida
Importe compras novas → «Atualizar análise de risco» (reconhece reativações, cria oportunidades e avisos) → nova rodada RFM mensal. Para automatizar, agende `select public.pv_refresh(<org>)` e `pv_rfm_run(<org>)` com um usuário gestor.

## LGPD e operação
- Quem implanta é o controlador. Defina a base legal por canal e mantenha registro (referência por cliente).
- Anonimização por cliente (administração); pedidos de titulares: página «Privacidade (LGPD)» do Core. Exportações ficam na auditoria.
- O sistema não envia mensagens: o canal de contato é da empresa.

## Backup, restauração e rollback
Ative backups automáticos no Supabase e **teste a restauração** antes de usar dados reais. Rollback de código: reimplante a tag anterior. Migrações são só para frente: para desfazer, escreva uma migração nova. Rodadas RFM e eventos são históricos imutáveis por desenho.
