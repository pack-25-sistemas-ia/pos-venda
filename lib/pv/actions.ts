'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { actionContext, type Context } from '@/lib/auth/session';
import { fail, fieldErrorsFrom, messageForDbError, succeed, type ActionState } from '@/lib/actions/result';
import { logEvent } from '@/lib/log';
import { loadSettings } from './data';
import { zonedNoonIso } from './filters';
import { parseMoneyToCents } from './import';
import {
  activitySchema, campaignSchema, contactSchema, customerRecord, customerSchema, importSchema, oppActionSchema, preferenceSchema, purchaseSchema, refundSchema,
  segmentSchema, settingsSchema, suppressionSchema, templateSchema,
} from './validation';

export type SaveResult = ActionState & { id?: string; problems?: string[] };

const WRITERS = ['owner', 'admin', 'manager', 'member'] as const;
const MANAGERS = ['owner', 'admin', 'manager'] as const;
const ADMINS = ['owner', 'admin'] as const;
const idSchema = z.uuid();

/**
 * Mensagens escritas por nós no banco (funções pv_*) são seguras e úteis; erros nativos do Postgres (violação de
 * restrição etc.) viram mensagem genérica, sem vazar nomes de tabela ou coluna.
 */
function dbMessage(error: { code?: string; message?: string }, duplicate?: string): string {
  if (error.code === '23505' && duplicate) return duplicate;
  if (error.code === '23503') return 'Este registro está em uso ou referencia algo inexistente.';
  const own = ['23514', '22023', 'P0002', '42501'];
  const msg = error.message ?? '';
  if (own.includes(error.code ?? '') && msg && msg.length <= 200 && !/violat|constraint|relation|column|violação|restrição/i.test(msg)) {
    return msg.charAt(0).toUpperCase() + msg.slice(1) + (msg.endsWith('.') ? '' : '.');
  }
  return messageForDbError(error);
}

async function withContext(roles: readonly ('owner' | 'admin' | 'manager' | 'member')[]): Promise<{ ctx: Context } | { error: ActionState }> {
  return actionContext(roles);
}
function bust(...paths: string[]) {
  for (const p of paths) revalidatePath(p);
}
const org = (ctx: Context) => ctx.membership.organization_id;

// ===================================================================== clientes
export async function createCustomer(input: unknown): Promise<SaveResult> {
  const auth = await withContext(WRITERS);
  if ('error' in auth) return auth.error;
  const { ctx } = auth;
  const parsed = customerSchema.safeParse(input);
  if (!parsed.success) return fail('Verifique os campos.', fieldErrorsFrom(parsed.error));
  const rec = customerRecord(parsed.data);
  const { data, error } = await ctx.supabase.from('customers').insert({ organization_id: org(ctx), ...rec }).select('id').single();
  if (error) {
    const dup = error.code === '23505';
    return fail(dbMessage(error, 'Já existe um cliente com este e-mail, documento ou identificador.'), dup ? { email: ['Já cadastrado (e-mail, documento ou identificador).'] } : undefined);
  }
  bust('/clientes', '/dashboard');
  return { ...succeed('Cliente cadastrado.'), id: (data as { id: string }).id };
}

export async function updateCustomer(id: string, input: unknown): Promise<SaveResult> {
  const auth = await withContext(WRITERS);
  if ('error' in auth) return auth.error;
  const { ctx } = auth;
  if (!idSchema.safeParse(id).success) return fail('Registro inválido.');
  const parsed = customerSchema.safeParse(input);
  if (!parsed.success) return fail('Verifique os campos.', fieldErrorsFrom(parsed.error));
  const { data, error } = await ctx.supabase.from('customers').update(customerRecord(parsed.data)).eq('id', id).eq('organization_id', org(ctx)).select('id');
  if (error) return fail(dbMessage(error, 'Já existe outro cliente com este e-mail, documento ou identificador.'));
  if (!data?.length) return fail('Você não tem permissão para alterar este cliente.');
  bust('/clientes', `/clientes/${id}`);
  return { ...succeed('Cliente atualizado.'), id };
}

export async function archiveCustomer(id: string, archive: boolean): Promise<ActionState> {
  const auth = await withContext(MANAGERS);
  if ('error' in auth) return auth.error;
  const { ctx } = auth;
  if (!idSchema.safeParse(id).success) return fail('Registro inválido.');
  const { data, error } = await ctx.supabase.from('customers').update({ archived_at: archive ? new Date().toISOString() : null }).eq('id', id).eq('organization_id', org(ctx)).select('id');
  if (error) return fail(dbMessage(error, 'Já existe um cliente ativo com o mesmo e-mail, documento ou identificador.'));
  if (!data?.length) return fail('Você não tem permissão para esta ação.');
  bust('/clientes', `/clientes/${id}`, '/dashboard');
  return succeed(archive ? 'Cliente arquivado.' : 'Cliente restaurado.');
}

export async function assignCustomer(id: string, userId: string | null): Promise<ActionState> {
  const auth = await withContext(MANAGERS);
  if ('error' in auth) return auth.error;
  const { ctx } = auth;
  if (!idSchema.safeParse(id).success || (userId !== null && !idSchema.safeParse(userId).success)) return fail('Registro inválido.');
  const { error } = await ctx.supabase.rpc('pv_assign_customer', { p_customer: id, p_to: userId });
  if (error) return fail(dbMessage(error));
  bust('/clientes', `/clientes/${id}`, '/reativacao', '/dashboard');
  return succeed(userId ? 'Responsável atribuído.' : 'Cliente sem responsável.');
}

export async function anonymizeCustomer(id: string): Promise<ActionState> {
  const auth = await withContext(ADMINS);
  if ('error' in auth) return auth.error;
  const { ctx } = auth;
  if (!idSchema.safeParse(id).success) return fail('Registro inválido.');
  const { error } = await ctx.supabase.rpc('pv_anonymize_customer', { p_customer: id });
  if (error) return fail(dbMessage(error));
  bust('/clientes', `/clientes/${id}`, '/dashboard');
  return succeed('Dados pessoais removidos. Compras e números agregados foram mantidos.');
}

export async function setPreference(customerId: string, input: unknown): Promise<ActionState> {
  const auth = await withContext(WRITERS);
  if ('error' in auth) return auth.error;
  const { ctx } = auth;
  if (!idSchema.safeParse(customerId).success) return fail('Registro inválido.');
  const parsed = preferenceSchema.safeParse(input);
  if (!parsed.success) return fail('Verifique os campos.', fieldErrorsFrom(parsed.error));
  const { error } = await ctx.supabase.rpc('pv_set_preference', { p_customer: customerId, p_channel: parsed.data.channel, p_status: parsed.data.status, p_basis: parsed.data.basis || null });
  if (error) return fail(dbMessage(error));
  bust(`/clientes/${customerId}`, '/campanhas');
  return succeed('Preferência de contato registrada.');
}

export async function setPreferenceBulk(input: unknown): Promise<ActionState> {
  const auth = await withContext(MANAGERS);
  if ('error' in auth) return auth.error;
  const { ctx } = auth;
  const parsed = preferenceSchema.safeParse(input);
  if (!parsed.success) return fail('Verifique os campos.', fieldErrorsFrom(parsed.error));
  const { data, error } = await ctx.supabase.rpc('pv_set_preference_bulk', { p_org: org(ctx), p_channel: parsed.data.channel, p_status: parsed.data.status, p_basis: parsed.data.basis });
  if (error) return fail(dbMessage(error));
  bust('/clientes', '/campanhas');
  return succeed(`${Number(data ?? 0)} cliente(s) sem preferência registrada receberam esta permissão. Preferências já registradas foram preservadas.`);
}

export async function suppressCustomer(customerId: string, input: unknown): Promise<ActionState> {
  const auth = await withContext(WRITERS);
  if ('error' in auth) return auth.error;
  const { ctx } = auth;
  if (!idSchema.safeParse(customerId).success) return fail('Registro inválido.');
  const parsed = suppressionSchema.safeParse(input);
  if (!parsed.success) return fail('Verifique os campos.', fieldErrorsFrom(parsed.error));
  const { error } = await ctx.supabase.rpc('pv_suppress', { p_customer: customerId, p_channel: parsed.data.channel, p_reason: parsed.data.reason });
  if (error) return fail(dbMessage(error));
  bust(`/clientes/${customerId}`, '/campanhas');
  return succeed('Cliente incluído na lista de supressão.');
}

export async function liftSuppression(id: string, customerId: string): Promise<ActionState> {
  const auth = await withContext(MANAGERS);
  if ('error' in auth) return auth.error;
  const { ctx } = auth;
  if (!idSchema.safeParse(id).success) return fail('Registro inválido.');
  const { error } = await ctx.supabase.rpc('pv_lift_suppression', { p_id: id });
  if (error) return fail(dbMessage(error));
  bust(`/clientes/${customerId}`, '/campanhas');
  return succeed('Supressão levantada.');
}

// ===================================================================== compras
export async function createPurchase(input: unknown): Promise<SaveResult> {
  const auth = await withContext(WRITERS);
  if ('error' in auth) return auth.error;
  const { ctx } = auth;
  const parsed = purchaseSchema.safeParse(input);
  if (!parsed.success) return fail('Verifique os campos.', fieldErrorsFrom(parsed.error));
  const v = parsed.data;
  const settings = await loadSettings(ctx);
  const items = v.items.map((it) => {
    const unit = Number(parseMoneyToCents(it.unit_price));
    return { product_name: it.product_name, category: it.category, quantity: it.quantity, unit_price_cents: unit, total_cents: Math.round(unit * it.quantity) };
  });
  const total = v.total !== '' ? Number(parseMoneyToCents(v.total)) : items.reduce((a, b) => a + b.total_cents, 0);
  const { data, error } = await ctx.supabase.rpc('pv_purchase_create', {
    p_customer: v.customer_id, p_external: v.external_order_id, p_at: zonedNoonIso(v.date, settings.timezone), p_total_cents: total, p_items: items,
    p_source: v.source ?? 'manual', p_notes: v.notes, p_allow_duplicate: Boolean(v.allow_duplicate),
  });
  if (error) return fail(dbMessage(error));
  const r = data as { ok?: boolean; error?: string; id?: string };
  if (!r?.ok) {
    return fail(r?.error === 'duplicate_external' ? 'Já existe uma compra com este número de pedido.' : 'Possível compra duplicada (mesmo cliente, dia e valor). Confirme se deseja registrar mesmo assim.', r?.error === 'possible_duplicate' ? { _duplicate: ['1'] } : undefined);
  }
  bust(`/clientes/${v.customer_id}`, '/compras', '/clientes', '/dashboard', '/reativacao');
  return { ...succeed('Compra registrada.'), id: r.id };
}

export async function cancelPurchase(id: string, customerId: string): Promise<ActionState> {
  const auth = await withContext(MANAGERS);
  if ('error' in auth) return auth.error;
  const { ctx } = auth;
  if (!idSchema.safeParse(id).success) return fail('Registro inválido.');
  const { error } = await ctx.supabase.rpc('pv_purchase_cancel', { p_purchase: id });
  if (error) return fail(dbMessage(error));
  bust(`/clientes/${customerId}`, '/compras', '/clientes', '/dashboard', '/reativacao');
  return succeed('Compra cancelada. Ela deixa de contar nos indicadores; reativações e resultados ligados a ela foram desfeitos.');
}

export async function refundPurchase(id: string, customerId: string, input: unknown): Promise<ActionState> {
  const auth = await withContext(MANAGERS);
  if ('error' in auth) return auth.error;
  const { ctx } = auth;
  if (!idSchema.safeParse(id).success) return fail('Registro inválido.');
  const parsed = refundSchema.safeParse(input);
  if (!parsed.success) return fail('Verifique os campos.', fieldErrorsFrom(parsed.error));
  const { error } = await ctx.supabase.rpc('pv_purchase_refund', { p_purchase: id, p_cents: Number(parseMoneyToCents(parsed.data.amount)) });
  if (error) return fail(dbMessage(error));
  bust(`/clientes/${customerId}`, '/compras', '/clientes', '/dashboard', '/reativacao');
  return succeed('Estorno registrado.');
}

// ===================================================================== importação (assistente)
export type ImportReport = ActionState & {
  total?: number; accepted?: number; duplicates?: number; invalid?: number; customersCreated?: number; lines?: string[]; preview?: boolean; alreadyImported?: boolean; jobId?: string | null;
};

/** Prévia e gravação passam pelo MESMO caminho no banco: a prévia desfaz tudo no fim. */
export async function runImport(input: unknown): Promise<ImportReport> {
  const auth = await withContext(MANAGERS);
  if ('error' in auth) return auth.error;
  const { ctx } = auth;
  const parsed = importSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Dados da importação inválidos.');
  const v = parsed.data;
  const common = { p_org: org(ctx), p_file_name: v.fileName, p_hash: v.hash || null, p_rows: v.rows, p_apply: v.apply, p_mapping: v.mapping };
  const { data, error } = v.kind === 'customers'
    ? await ctx.supabase.rpc('pv_import_customers', common)
    : await ctx.supabase.rpc('pv_import_purchases', { ...common, p_create_missing: Boolean(v.createMissing) });
  if (error) return fail(dbMessage(error));
  const r = data as { total: number; accepted: number; duplicates: number; invalid: number; customers_created?: number; lines: string[]; job_id: string | null; already_imported_file?: boolean };
  const base = {
    total: r.total, accepted: r.accepted, duplicates: r.duplicates, invalid: r.invalid, customersCreated: r.customers_created ?? 0, lines: r.lines, jobId: r.job_id, alreadyImported: Boolean(r.already_imported_file),
  };
  const what = v.kind === 'customers' ? 'cliente(s)' : 'compra(s)';
  if (!v.apply) return { ...succeed(`Validação concluída: ${r.accepted} ${what} prontos para importar, ${r.duplicates} duplicado(s), ${r.invalid} com erro. Nada foi gravado.`), ...base, preview: true };
  if (r.accepted === 0) return { ...fail('Nenhuma linha válida para importar.'), ...base };
  logEvent('info', 'pv_import_applied', { kind: v.kind, accepted: r.accepted });
  bust('/clientes', '/compras', '/dashboard', '/reativacao', '/segmentacao');
  return { ...succeed(`${r.accepted} ${what} importado(s).`), ...base };
}

// ===================================================================== motor RFM e oportunidades
export async function runRfm(): Promise<ActionState> {
  const auth = await withContext(MANAGERS);
  if ('error' in auth) return auth.error;
  const { ctx } = auth;
  const { error } = await ctx.supabase.rpc('pv_rfm_run', { p_org: org(ctx) });
  if (error) return fail(dbMessage(error));
  bust('/segmentacao', '/dashboard', '/clientes', '/configuracoes');
  return succeed('Nova rodada RFM calculada. As rodadas anteriores foram preservadas no histórico.');
}

export async function refreshOpportunities(): Promise<ActionState> {
  const auth = await withContext(MANAGERS);
  if ('error' in auth) return auth.error;
  const { ctx } = auth;
  const { data, error } = await ctx.supabase.rpc('pv_refresh', { p_org: org(ctx) });
  if (error) return fail(dbMessage(error));
  const r = (data ?? {}) as { opportunities_touched?: number; opportunities_closed?: number; reactivated?: number };
  bust('/reativacao', '/dashboard', '/clientes', '/campanhas', '/atividades', '/notificacoes');
  return succeed(`Análise concluída: ${r.opportunities_touched ?? 0} oportunidade(s) criada(s) ou atualizada(s), ${r.reactivated ?? 0} reativação(ões) reconhecida(s), ${r.opportunities_closed ?? 0} encerrada(s) por a regra não valer mais.`);
}

export async function opportunityAction(id: string, input: unknown): Promise<ActionState> {
  const auth = await withContext(WRITERS);
  if ('error' in auth) return auth.error;
  const { ctx } = auth;
  if (!idSchema.safeParse(id).success) return fail('Registro inválido.');
  const parsed = oppActionSchema.safeParse(input);
  if (!parsed.success) return fail('Ação inválida.');
  const { action, value } = parsed.data;
  if (action === 'discard' && !value) return fail('Informe o motivo do descarte.', { value: ['Informe o motivo.'] });
  if (action === 'assign' && value && !idSchema.safeParse(value).success) return fail('Responsável inválido.');
  const { error } = await ctx.supabase.rpc('pv_opp_action', { p_opp: id, p_action: action, p_value: value ?? null });
  if (error) return fail(dbMessage(error));
  bust('/reativacao', '/dashboard', '/clientes');
  return succeed({ start: 'Oportunidade em andamento.', next_action: 'Próxima ação salva.', assign: 'Responsável atribuído.', discard: 'Oportunidade descartada.', reactivated: 'Reativação confirmada com a compra registrada.' }[action]);
}

// ===================================================================== segmentos
export async function previewSegment(criteria: unknown): Promise<ActionState & { count?: number }> {
  const auth = await withContext(WRITERS);
  if ('error' in auth) return auth.error;
  const { ctx } = auth;
  const parsed = segmentSchema.shape.criteria.safeParse(criteria);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Critérios inválidos.');
  const { data, error } = await ctx.supabase.rpc('pv_segment_members', { p_org: org(ctx), p_criteria: parsed.data });
  if (error) return fail(dbMessage(error));
  const count = Array.isArray(data) ? data.length : 0;
  return { ...succeed(`${count} cliente(s) atendem a estes critérios hoje.`), count };
}

export async function saveSegment(id: string | null, input: unknown): Promise<SaveResult> {
  const auth = await withContext(MANAGERS);
  if ('error' in auth) return auth.error;
  const { ctx } = auth;
  if (id !== null && !idSchema.safeParse(id).success) return fail('Registro inválido.');
  const parsed = segmentSchema.safeParse(input);
  if (!parsed.success) return fail('Verifique os campos.', fieldErrorsFrom(parsed.error));
  const row = { name: parsed.data.name, description: parsed.data.description, criteria_json: parsed.data.criteria };
  if (id === null) {
    const { data, error } = await ctx.supabase.from('segment_definitions').insert({ organization_id: org(ctx), segment_type: 'custom', ...row }).select('id').single();
    if (error) return fail(dbMessage(error));
    const segId = (data as { id: string }).id;
    await ctx.supabase.rpc('pv_segment_refresh', { p_segment: segId });
    bust('/segmentacao', '/campanhas');
    return { ...succeed('Segmento criado.'), id: segId };
  }
  const { data, error } = await ctx.supabase.from('segment_definitions').update(row).eq('id', id).eq('organization_id', org(ctx)).eq('segment_type', 'custom').select('id');
  if (error) return fail(dbMessage(error));
  if (!data?.length) return fail('Segmentos do sistema não podem ser editados.');
  await ctx.supabase.rpc('pv_segment_refresh', { p_segment: id });
  bust('/segmentacao', '/campanhas');
  return { ...succeed('Segmento atualizado.'), id };
}

export async function refreshSegment(id: string): Promise<ActionState> {
  const auth = await withContext(MANAGERS);
  if ('error' in auth) return auth.error;
  const { ctx } = auth;
  if (!idSchema.safeParse(id).success) return fail('Registro inválido.');
  const { data, error } = await ctx.supabase.rpc('pv_segment_refresh', { p_segment: id });
  if (error) return fail(dbMessage(error));
  bust('/segmentacao');
  return succeed(`Segmento atualizado: ${Number(data ?? 0)} cliente(s).`);
}

export async function deleteSegment(id: string): Promise<ActionState> {
  const auth = await withContext(MANAGERS);
  if ('error' in auth) return auth.error;
  const { ctx } = auth;
  if (!idSchema.safeParse(id).success) return fail('Registro inválido.');
  const { data, error } = await ctx.supabase.from('segment_definitions').delete().eq('id', id).eq('organization_id', org(ctx)).eq('segment_type', 'custom').select('id');
  if (error) return fail(dbMessage(error));
  if (!data?.length) return fail('Segmentos do sistema não podem ser excluídos.');
  bust('/segmentacao', '/campanhas');
  return succeed('Segmento excluído. Campanhas existentes mantêm o público já calculado.');
}

// ===================================================================== campanhas e modelos
export async function saveCampaign(id: string | null, input: unknown): Promise<SaveResult> {
  const auth = await withContext(MANAGERS);
  if ('error' in auth) return auth.error;
  const { ctx } = auth;
  if (id !== null && !idSchema.safeParse(id).success) return fail('Registro inválido.');
  const parsed = campaignSchema.safeParse(input);
  if (!parsed.success) return fail('Verifique os campos.', fieldErrorsFrom(parsed.error));
  const v = parsed.data;
  const row = {
    name: v.name, description: v.description, objective: v.objective, channel: v.channel, segment_id: v.segment_id, owner_id: v.owner_id,
    message_subject: v.message_subject, message_body: v.message_body, observation_days: v.observation_days,
  };
  if (id === null) {
    const { data, error } = await ctx.supabase.from('campaigns').insert({ organization_id: org(ctx), ...row }).select('id').single();
    if (error) return fail(dbMessage(error));
    bust('/campanhas');
    return { ...succeed('Campanha criada como rascunho.'), id: (data as { id: string }).id };
  }
  const { data, error } = await ctx.supabase.from('campaigns').update(row).eq('id', id).eq('organization_id', org(ctx)).select('id');
  if (error) return fail(dbMessage(error));
  if (!data?.length) return fail('Você não tem permissão para esta ação.');
  bust('/campanhas', `/campanhas/${id}`);
  return { ...succeed('Campanha atualizada.'), id };
}

export async function snapshotCampaign(id: string): Promise<ActionState> {
  const auth = await withContext(MANAGERS);
  if ('error' in auth) return auth.error;
  const { ctx } = auth;
  if (!idSchema.safeParse(id).success) return fail('Registro inválido.');
  const { data, error } = await ctx.supabase.rpc('pv_campaign_snapshot', { p_campaign: id });
  if (error) return fail(dbMessage(error));
  const r = (data ?? {}) as { eligible?: number; excluded?: number };
  bust('/campanhas', `/campanhas/${id}`);
  return succeed(`Público calculado: ${r.eligible ?? 0} elegível(is) e ${r.excluded ?? 0} excluído(s) (sem permissão registrada, negada, suprimida ou arquivada).`);
}

export async function setCampaignStatus(id: string, status: string): Promise<ActionState> {
  const auth = await withContext(MANAGERS);
  if ('error' in auth) return auth.error;
  const { ctx } = auth;
  if (!idSchema.safeParse(id).success) return fail('Registro inválido.');
  if (!['draft', 'planned', 'running', 'paused', 'completed', 'cancelled'].includes(status)) return fail('Status inválido.');
  const { error } = await ctx.supabase.rpc('pv_campaign_set_status', { p_campaign: id, p_status: status });
  if (error) return fail(dbMessage(error));
  bust('/campanhas', `/campanhas/${id}`, '/dashboard');
  return succeed('Status da campanha atualizado.');
}

export async function logCampaignContact(campaignId: string, customerId: string, input: unknown): Promise<ActionState> {
  const auth = await withContext(WRITERS);
  if ('error' in auth) return auth.error;
  const { ctx } = auth;
  if (!idSchema.safeParse(campaignId).success || !idSchema.safeParse(customerId).success) return fail('Registro inválido.');
  const parsed = contactSchema.safeParse(input);
  if (!parsed.success) return fail('Verifique os campos.', fieldErrorsFrom(parsed.error));
  const { error } = await ctx.supabase.rpc('pv_campaign_log_contact', { p_campaign: campaignId, p_customer: customerId, p_status: parsed.data.status, p_notes: parsed.data.notes });
  if (error) return fail(dbMessage(error));
  bust(`/campanhas/${campaignId}`, `/clientes/${customerId}`, '/dashboard', '/reativacao');
  return succeed(parsed.data.status === 'refused' ? 'Recusa registrada. O cliente foi incluído na lista de supressão deste canal.' : 'Contato registrado.');
}

export async function saveTemplate(id: string | null, input: unknown): Promise<SaveResult> {
  const auth = await withContext(MANAGERS);
  if ('error' in auth) return auth.error;
  const { ctx } = auth;
  if (id !== null && !idSchema.safeParse(id).success) return fail('Registro inválido.');
  const parsed = templateSchema.safeParse(input);
  if (!parsed.success) return fail('Verifique os campos.', fieldErrorsFrom(parsed.error));
  const v = parsed.data;
  if (id === null) {
    const key = `${v.name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30) || 'modelo'}_${Math.random().toString(36).slice(2, 6)}`;
    const { data, error } = await ctx.supabase.from('message_templates').insert({ organization_id: org(ctx), template_key: key, name: v.name, channel: v.channel, subject: v.subject, body: v.body, active: v.active }).select('id').single();
    if (error) return fail(dbMessage(error));
    bust('/campanhas/modelos', '/campanhas');
    return { ...succeed('Modelo criado.'), id: (data as { id: string }).id };
  }
  const { data, error } = await ctx.supabase.from('message_templates').update({ name: v.name, channel: v.channel, subject: v.subject, body: v.body, active: v.active }).eq('id', id).eq('organization_id', org(ctx)).select('id');
  if (error) return fail(dbMessage(error));
  if (!data?.length) return fail('Você não tem permissão para esta ação.');
  bust('/campanhas/modelos', '/campanhas');
  return { ...succeed('Modelo atualizado.'), id };
}

export async function deleteTemplate(id: string): Promise<ActionState> {
  const auth = await withContext(MANAGERS);
  if ('error' in auth) return auth.error;
  const { ctx } = auth;
  if (!idSchema.safeParse(id).success) return fail('Registro inválido.');
  const { data, error } = await ctx.supabase.from('message_templates').delete().eq('id', id).eq('organization_id', org(ctx)).select('id');
  if (error) return fail(dbMessage(error));
  if (!data?.length) return fail('Você não tem permissão para esta ação.');
  bust('/campanhas/modelos');
  return succeed('Modelo excluído.');
}

// ===================================================================== tarefas
export async function addActivity(customerId: string, input: unknown): Promise<SaveResult> {
  const auth = await withContext(WRITERS);
  if ('error' in auth) return auth.error;
  const { ctx } = auth;
  if (!idSchema.safeParse(customerId).success) return fail('Registro inválido.');
  const parsed = activitySchema.safeParse(input);
  if (!parsed.success) return fail('Verifique os campos.', fieldErrorsFrom(parsed.error));
  const v = parsed.data;
  const { data, error } = await ctx.supabase.from('customer_activities').insert({
    organization_id: org(ctx), customer_id: customerId, type: v.type, title: v.title, description: v.description, priority: v.priority, assigned_to: v.assigned_to ?? ctx.user.id,
    campaign_id: v.campaign_id, opportunity_id: v.opportunity_id, due_at: v.due_at, completed_at: v.done ? new Date().toISOString() : null,
  }).select('id').single();
  if (error) return fail(dbMessage(error));
  bust(`/clientes/${customerId}`, '/atividades', '/dashboard');
  return { ...succeed(v.done ? 'Atividade registrada.' : 'Tarefa agendada.'), id: (data as { id: string }).id };
}

export async function completeActivity(id: string, customerId: string, done: boolean): Promise<ActionState> {
  const auth = await withContext(WRITERS);
  if ('error' in auth) return auth.error;
  const { ctx } = auth;
  if (!idSchema.safeParse(id).success) return fail('Registro inválido.');
  const { data, error } = await ctx.supabase.from('customer_activities').update({ completed_at: done ? new Date().toISOString() : null }).eq('id', id).eq('organization_id', org(ctx)).select('id');
  if (error) return fail(dbMessage(error));
  if (!data?.length) return fail('Você não tem permissão para esta ação.');
  bust(`/clientes/${customerId}`, '/atividades', '/dashboard');
  return succeed(done ? 'Tarefa concluída.' : 'Tarefa reaberta.');
}

// ===================================================================== notificações
export async function markNotifications(id: string | null): Promise<ActionState> {
  // qualquer membro (inclusive leitor) marca as PRÓPRIAS notificações como lidas
  const auth = await actionContext();
  if ('error' in auth) return auth.error;
  const { ctx } = auth;
  if (id !== null && !idSchema.safeParse(id).success) return fail('Registro inválido.');
  let q = ctx.supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('user_id', ctx.user.id).eq('organization_id', org(ctx)).is('read_at', null);
  if (id) q = q.eq('id', id);
  const { error } = await q;
  if (error) return fail(dbMessage(error));
  bust('/notificacoes', '/dashboard');
  return succeed(id ? 'Notificação lida.' : 'Todas as notificações foram marcadas como lidas.');
}

// ===================================================================== configurações
export async function saveSettings(input: unknown): Promise<ActionState> {
  const auth = await withContext(ADMINS);
  if ('error' in auth) return auth.error;
  const { ctx } = auth;
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return fail('Verifique os campos.', fieldErrorsFrom(parsed.error));
  const { limits_r, limits_f, limits_m, ...rest } = parsed.data;
  const { data, error } = await ctx.supabase.from('pv_settings').update({ ...rest, rfm_limits: { r: limits_r, f: limits_f, m: limits_m } }).eq('organization_id', org(ctx)).select('organization_id');
  if (error) return fail(dbMessage(error));
  if (!data?.length) return fail('Você não tem permissão para alterar as configurações.');
  bust('/configuracoes', '/dashboard', '/segmentacao', '/reativacao');
  return succeed('Configurações salvas. Elas valem na próxima análise; o histórico de rodadas anteriores não muda.');
}
