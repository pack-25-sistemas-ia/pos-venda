#!/usr/bin/env node
// Teste de mutação das regras críticas do banco: quebra cada regra DE PROPÓSITO numa cópia das migrações
// e exige que a suíte (pnpm test:db) reprove. Se alguma mutação sobreviver, falta teste.
// Uso: node scripts/mutation-check.mjs [--only <trecho do nome>] [--jobs 3]
import { spawn } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const jobs = Number(args.includes('--jobs') ? args[args.indexOf('--jobs') + 1] : 3);

// { name, file (trecho do arquivo), find, replace, nth (1 = primeira ocorrência) }
const M = [
  // --- RFM: notas e segmentos
  { name: 'RFM: recência não invertida', file: 'pv_engine', find: 'least(5, 1 + (5 * (n - 1 - br)) / (n - 1))', replace: 'least(5, 1 + (5 * br) / (n - 1))' },
  { name: 'RFM: frequência sem teto', file: 'pv_engine', find: "'f_score', case when n <= 1 then 1 else least(5, 1 + (5 * bf) / (n - 1)) end::int", replace: "'f_score', case when n <= 1 then 1 else (1 + (5 * bf) / (n - 1)) end::int" },
  { name: 'RFM: empates com ranking denso', file: 'pv_engine', find: 'rank() over (order by f) - 1 as bf', replace: 'dense_rank() over (order by f) - 1 as bf' },
  { name: 'RFM: limite fixo de F/M exclusivo', file: 'pv_engine', find: 'when v >= d then 5 when v >= c then 4', replace: 'when v > d then 5 when v >= c then 4' },
  { name: 'RFM: limite fixo de recência exclusivo', file: 'pv_engine', find: 'return case when v <= a then 5', replace: 'return case when v < a then 5' },
  { name: 'RFM: janela inclui o dia da borda', file: 'pv_engine', find: 'where d > ref - win group by customer_id', replace: 'where d >= ref - win group by customer_id' },
  { name: 'RFM: janela inválida aceita', file: 'pv_engine', find: 'if win not between 30 and 1095 then', replace: 'if false then' },
  { name: 'RFM: amostra pequena não sinalizada', file: 'pv_engine', find: 'low := n_scored < 5;', replace: 'low := false;' },
  { name: 'segmento: campeões sem exigir valor', file: 'pv_engine', find: "when r >= 4 and f >= 4 and m >= 4 then 'campeoes'", replace: "when r >= 4 and f >= 4 then 'campeoes'" },
  { name: 'segmento: fiéis sem exigir frequência', file: 'pv_engine', find: "when r >= 3 and f >= 3 then 'fieis'", replace: "when r >= 3 then 'fieis'" },
  { name: 'segmento: novos ignora a frequência', file: 'pv_engine', find: 'when frequency = 1 and first_days <= new_days', replace: 'when first_days <= new_days' },
  { name: 'segmento: novos com limite exclusivo', file: 'pv_engine', find: 'first_days <= new_days then', replace: 'first_days < new_days then' },
  { name: 'segmento: em risco exige F e M', file: 'pv_engine', find: '(f >= 3 or m >= 3)', replace: '(f >= 3 and m >= 3)' },
  { name: 'segmento: sem compras na janela vira «sem compras»', file: 'pv_engine', find: "(case when coalesce(t.n_all, 0) > 0 then 'inativos' else 'sem_compras' end)", replace: "'sem_compras'" },
  { name: 'histórico: rodadas editáveis', file: 'pv_schema', find: 'create trigger rfm_runs_immutable before update on public.rfm_runs for each row execute function private.pv_append_only();', replace: '' },
  { name: 'histórico: notas editáveis', file: 'pv_schema', find: 'create trigger rfm_scores_immutable before update on public.customer_rfm_scores for each row execute function private.pv_append_only();', replace: '' },
  // --- compra válida e sinais de risco
  { name: 'compra: cancelada conta como válida', file: 'pv_schema', find: "generated always as (status = 'completed' and total_cents - refunded_cents > 0) stored", replace: 'generated always as (total_cents - refunded_cents > 0) stored' },
  { name: 'compra: estorno total conta como válida', file: 'pv_schema', find: "generated always as (status = 'completed' and total_cents - refunded_cents > 0) stored", replace: "generated always as (status = 'completed' and total_cents - refunded_cents >= 0) stored" },
  { name: 'sinais: inatividade com limite exclusivo', file: 'pv_engine', find: 'b.ds >= s.risk_days then', replace: 'b.ds > s.risk_days then' },
  { name: 'sinais: ciclo sem mínimo de compras', file: 'pv_engine', find: 'b.n >= s.cycle_min_purchases and b.med_gap is not null', replace: 'b.med_gap is not null' },
  { name: 'sinais: ciclo com limite inclusivo', file: 'pv_engine', find: 'b.ds > s.cycle_factor * greatest(b.med_gap, 1)', replace: 'b.ds >= s.cycle_factor * greatest(b.med_gap, 1)' },
  { name: 'sinais: ciclo sem mínimo de dias', file: 'pv_engine', find: ' and b.ds >= s.cycle_min_days then', replace: ' then' },
  { name: 'sinais: queda sem mínimo no período anterior', file: 'pv_engine', find: 'b.o_prev >= s.drop_min_prev and ', replace: '' },
  { name: 'sinais: inativo com limite exclusivo', file: 'pv_engine', find: 'sig.ds >= s.inactive_days', replace: 'sig.ds > s.inactive_days' },
  { name: 'sinais: compras posteriores à data de referência contam', file: 'pv_engine', find: 'and (pu.purchased_at at time zone tz)::date <= p_ref', replace: '' },
  { name: 'sinais: cliente arquivado entra na análise', file: 'pv_engine', find: 'where c.organization_id = p_org and c.archived_at is null\n  ), sig as', replace: 'where c.organization_id = p_org\n  ), sig as' },
  { name: 'sinais: regra desligada continua valendo', file: 'pv_engine', find: 'case when s.rule_inactivity and b.ds is not null', replace: 'case when b.ds is not null' },
  // --- oportunidades e reativação
  { name: 'oportunidade: valor estimado com poucas compras', file: 'pv_engine', find: 'case when r.n_valid >= 3 then r.median_ticket_cents end', replace: 'r.median_ticket_cents' },
  { name: 'oportunidade: peso do valor ignorado', file: 'pv_engine', find: 'round((s.w_value * r.pm', replace: 'round((0 * r.pm' },
  { name: 'oportunidade: atraso sem teto', file: 'pv_engine', find: 'least(1, r.days_since / greatest(refd, 1))', replace: '(r.days_since / greatest(refd, 1))' },
  { name: 'oportunidade: trabalhada também é descartada na atualização', file: 'pv_engine', find: "where o.organization_id = p_org and o.status = 'open' and o.reason <> 'segment_change'", replace: "where o.organization_id = p_org and o.status in ('open', 'in_progress') and o.reason <> 'segment_change'" },
  { name: 'reativação: compra anterior à oportunidade conta', file: 'pv_engine', find: '::date >= (r.identified_at at time zone tz)::date order by', replace: "::date >= (r.identified_at at time zone tz)::date - 3650 order by" },
  { name: 'reativação: compra do dia da identificação não conta', file: 'pv_engine', find: '::date >= (r.identified_at at time zone tz)::date order by', replace: '::date > (r.identified_at at time zone tz)::date order by' },
  { name: 'campanha: compra do mesmo dia do contato conta', file: 'pv_engine', find: '::date > (k.first_contact at time zone tz)::date and', replace: '::date >= (k.first_contact at time zone tz)::date and' },
  { name: 'reativação: estorno/cancelamento não reabre a oportunidade', file: 'pv_operations', find: "update public.reactivation_opportunities set status = 'open', resolved_at = null, reactivated_purchase_id = null where reactivated_purchase_id = p_purchase;", replace: '' },
  { name: 'reativação: evento permanece após o estorno', file: 'pv_operations', find: "delete from public.customer_lifecycle_events where event_type = 'reactivated' and (metadata ->> 'purchase_id') = p_purchase::text;", replace: '' },
  { name: 'reativação: resultado de campanha permanece após o estorno', file: 'pv_operations', find: 'delete from public.campaign_outcomes where related_purchase_id = p_purchase;', replace: '' },
  { name: 'compra: estorno total não desfaz a reativação', file: 'pv_operations', find: 'if p.refunded_cents + p_cents = p.total_cents then perform private.pv_unwind_purchase(p_purchase); end if;', replace: '' },
  { name: 'compra: estorno maior que o total aceito', file: 'pv_operations', find: ' or p.refunded_cents + p_cents > p.total_cents then', replace: ' then' },
  { name: 'compra: data futura aceita', file: 'pv_operations', find: "p_at > now() + interval '1 day' or ", replace: '' },
  // --- campanhas, permissões e supressão
  { name: 'campanha: recompra antes do contato conta', file: 'pv_engine', find: '::date > (k.first_contact at time zone tz)::date and', replace: "::date > (k.first_contact at time zone tz)::date - 3650 and" },
  { name: 'campanha: janela de observação ignorada', file: 'pv_engine', find: ' and (pu.purchased_at at time zone tz)::date <= (k.first_contact at time zone tz)::date + c.observation_days', replace: '' },
  { name: 'campanha: usa o último contato, não o primeiro', file: 'pv_engine', find: 'min(ct.contacted_at) as first_contact', replace: 'max(ct.contacted_at) as first_contact' },
  { name: 'elegibilidade: ausência de preferência vale como consentimento', file: 'pv_operations', find: "if pref is null then return 'sem_permissao_registrada'; end if;", replace: '' },
  { name: 'elegibilidade: permissão negada ignorada', file: 'pv_operations', find: "if pref = 'denied' then return 'permissao_negada'; end if;", replace: '' },
  { name: 'elegibilidade: supressão ignorada', file: 'pv_operations', find: "if exists (select 1 from public.suppression_entries s where s.customer_id = cust and s.lifted_at is null and (s.channel is null or s.channel = ch)) then return 'suprimido'; end if;", replace: '' },
  { name: 'elegibilidade: supressão de outro canal bloqueia', file: 'pv_operations', find: '(s.channel is null or s.channel = ch)', replace: 'true' },
  { name: 'elegibilidade: supressão levantada continua valendo', file: 'pv_operations', find: 's.customer_id = cust and s.lifted_at is null', replace: 's.customer_id = cust' },
  { name: 'campanha: recusa não gera supressão', file: 'pv_operations', find: "if p_status = 'refused' then", replace: 'if false then' },
  { name: 'campanha: contato a cliente fora do público', file: 'pv_operations', find: "if not found or m.status = 'excluded' then", replace: 'if not found then' },
  { name: 'campanha: contato com a campanha parada', file: 'pv_operations', find: "if c.status <> 'running' then raise exception", replace: 'if false then raise exception' },
  { name: 'campanha: contato sem checar elegibilidade', file: 'pv_operations', find: "if why is not null then raise exception 'cliente não pode ser contatado neste canal: %', why using errcode = '23514'; end if;", replace: '' },
  { name: 'campanha: início sem público calculado', file: 'pv_operations', find: 'and not exists (select 1 from public.campaign_memberships where campaign_id = p_campaign) then', replace: 'and false then' },
  { name: 'campanha: transição inválida aceita', file: 'pv_operations', find: "if not ok then raise exception 'transição de campanha não permitida", replace: "if false then raise exception 'transição de campanha não permitida" },
  { name: 'LGPD: base legal dispensada na preferência', file: 'pv_operations', find: "if p_status in ('granted', 'legitimate_interest') and nullif(btrim(coalesce(p_basis, '')), '') is null then", replace: 'if false then' },
  { name: 'LGPD: anonimização mantém o e-mail', file: 'pv_operations', find: "name = 'Anonimizado', email = null,", replace: "name = 'Anonimizado', email = email," },
  { name: 'LGPD: anonimização mantém o documento', file: 'pv_operations', find: 'document_number = null, external_customer_id = null', replace: 'external_customer_id = null' },
  // --- importação
  { name: 'importação: a prévia grava (clientes)', file: 'pv_operations', find: "if not p_apply then raise exception 'prévia' using errcode = 'PV001'; end if;", replace: '', nth: 1 },
  { name: 'importação: a prévia grava (compras)', file: 'pv_operations', find: "if not p_apply then raise exception 'prévia' using errcode = 'PV001'; end if;", replace: '', nth: 2 },
  { name: 'importação: sem limite de linhas (clientes)', file: 'pv_operations', find: 'jsonb_array_length(p_rows) > 2000', replace: 'false', nth: 1 },
  { name: 'importação: sem limite de linhas (compras)', file: 'pv_operations', find: 'jsonb_array_length(p_rows) > 2000', replace: 'false', nth: 2 },
  // --- segurança
  { name: 'segurança: vendedor altera cliente alheio', file: 'pv_operations', find: 'or not private.pv_can_write(c.organization_id, c.assigned_to) or not private.mfa_ok() then', replace: 'or not private.mfa_ok() then' },
  { name: 'segurança: MFA ignorado na escrita', file: 'pv_operations', find: 'private.pv_can_write(c.organization_id, c.assigned_to) or not private.mfa_ok() then', replace: 'private.pv_can_write(c.organization_id, c.assigned_to) then' },
  { name: 'segurança: vendedor lê clientes de outros', file: 'pv_schema', find: "when 'member' then assignee is not distinct from (select auth.uid()) else false end, false);\n$$;\ncreate function private.pv_can_write", replace: "when 'member' then true else false end, false);\n$$;\ncreate function private.pv_can_write" },
  { name: 'segurança: leitor escreve', file: 'pv_schema', find: "when 'owner' then true when 'admin' then true when 'manager' then true\n    when 'member' then assignee is not distinct from (select auth.uid()) else false end, false);\n$$;\ncreate function private.pv_is_manager", replace: "when 'owner' then true when 'admin' then true when 'manager' then true when 'viewer' then true\n    when 'member' then assignee is not distinct from (select auth.uid()) else false end, false);\n$$;\ncreate function private.pv_is_manager" },
  { name: 'segurança: responsável pode ser leitor', file: 'pv_operations', find: "m.user_id = p_to and m.role <> 'viewer'", replace: 'm.user_id = p_to' },
  { name: 'segurança: anônimo executa funções de operação', file: 'pv_operations', find: "execute format('revoke all on function %s from public, anon', f);", replace: "execute format('revoke all on function %s from public', f); execute format('grant execute on function %s to anon', f);" },
  { name: 'segurança: anônimo executa o motor', file: 'pv_engine', find: "execute format('revoke all on function %s from public, anon', f);", replace: "execute format('revoke all on function %s from public', f); execute format('grant execute on function %s to anon', f);" },
  // --- indicadores
  { name: 'métricas: período inclui o dia seguinte', file: 'pv_metrics', find: '((p_to + 1)::timestamp at time zone v_tz)', replace: '((p_to + 2)::timestamp at time zone v_tz)' },
  { name: 'métricas: fuso fixo em UTC', file: 'pv_metrics', find: '(p_from::timestamp at time zone v_tz)', replace: "(p_from::timestamp at time zone 'UTC')" },
  { name: 'métricas: indicadores sem isolamento (security definer)', file: 'pv_metrics', find: "language plpgsql stable security invoker set search_path = '' as $$\n#variable_conflict use_column\ndeclare w record; obs int;", replace: "language plpgsql stable security definer set search_path = '' as $$\n#variable_conflict use_column\ndeclare w record; obs int;" },
  { name: 'métricas: taxa de reativação conta janela ainda aberta', file: 'pv_metrics', find: ' and o.identified_at + make_interval(days => obs) <= now()', replace: '' },
  { name: 'métricas: reativação fora da janela conta', file: 'pv_metrics', find: 'c.resolved_at <= c.identified_at + make_interval(days => obs)', replace: 'true' },
  { name: 'métricas: primeira compra conta como recompra', file: 'pv_metrics', find: 'b.purchased_at < pu.purchased_at', replace: 'b.purchased_at <= pu.purchased_at' },
  { name: 'métricas: categoria diferencia maiúsculas', file: 'pv_metrics', find: 'lower(i.category) = lower(p_category)', replace: 'i.category = p_category' },
  { name: 'métricas: contato planejado conta como contatado', file: 'pv_metrics', find: "from public.campaign_contacts k where k.campaign_id = c.id and k.contact_status <> 'planned'),", replace: 'from public.campaign_contacts k where k.campaign_id = c.id),', nth: 1 },
  { name: 'métricas: alerta de prioridade alta sem limite', file: 'pv_metrics', find: "o.status = 'open' and o.priority >= s.priority_high", replace: "o.status = 'open'" },
  { name: 'métricas: rótulos de usuários vazam entre organizações', file: 'pv_metrics', find: 'where m.organization_id = p_org and private.is_member(p_org);', replace: 'where m.organization_id = p_org;' },
];

const migDir = join(root, 'supabase', 'migrations');
const files = readdirSync(migDir).filter((f) => f.endsWith('.sql'));

function runSuite(dir) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [join(dir, 'scripts', 'test-db.mjs')], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('close', (code) => resolve({ code, out }));
  });
}

function workspace(label, mutate) {
  const dir = mkdtempSync(join(tmpdir(), `pack25-mut-${label}-`));
  mkdirSync(join(dir, 'scripts'));
  cpSync(join(root, 'scripts', 'test-db.mjs'), join(dir, 'scripts', 'test-db.mjs'));
  cpSync(join(root, 'supabase'), join(dir, 'supabase'), { recursive: true });
  if (mutate) {
    const f = files.find((x) => x.includes(mutate.file));
    const path = join(dir, 'supabase', 'migrations', f);
    let text = readFileSync(path, 'utf8');
    const parts = text.split(mutate.find);
    const nth = mutate.nth ?? 1;
    if (parts.length < 2) throw new Error(`mutação sem alvo: ${mutate.name}`);
    if (parts.length > 2 && !mutate.nth) throw new Error(`mutação ambígua (${parts.length - 1} ocorrências): ${mutate.name}`);
    if (nth > parts.length - 1) throw new Error(`mutação sem a ocorrência ${nth}: ${mutate.name}`);
    text = parts.slice(0, nth).join(mutate.find) + mutate.replace + parts.slice(nth).join(mutate.find);
    writeFileSync(path, text);
  }
  return dir;
}

const base = workspace('base', null);
const baseline = await runSuite(base);
rmSync(base, { recursive: true, force: true });
if (baseline.code !== 0) {
  console.error('A suíte sem mutação já reprova; corrija antes.\n' + baseline.out.slice(-1500));
  process.exit(2);
}

const todo = M.filter((m) => !only || m.name.includes(only));
const survived = [];
const broken = [];
let next = 0;
async function worker() {
  while (next < todo.length) {
    const m = todo[next++];
    let dir;
    try {
      dir = workspace(String(next), m);
    } catch (e) {
      console.log(`SEM ALVO    ${m.name} — ${e.message}`);
      broken.push(m.name);
      continue;
    }
    const r = await runSuite(dir);
    rmSync(dir, { recursive: true, force: true });
    const killed = r.code !== 0;
    console.log(`${killed ? 'MORTA    ' : 'SOBREVIVEU'}  ${m.name}`);
    if (!killed) survived.push(m.name);
  }
}
await Promise.all(Array.from({ length: Math.max(1, jobs) }, worker));
console.log(`\n${todo.length - survived.length - broken.length}/${todo.length} mutações reprovadas pela suíte.`);
if (broken.length) console.error('Mutações sem alvo (o texto mudou):\n- ' + broken.join('\n- '));
if (survived.length) console.error('Sobreviveram:\n- ' + survived.join('\n- '));
if (survived.length || broken.length) process.exit(1);
