'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { Alert, Badge, Button, Field, Input, Select, Textarea } from '@/components/ui/primitives';
import { ActionButton, CheckField, FormShell, SelectField, TextAreaField, TextField, useActionForm, type Opt } from '@/components/app/form-kit';
import {
  deleteTemplate, logCampaignContact, saveCampaign, saveTemplate, setCampaignStatus, setPreferenceBulk, snapshotCampaign,
} from '@/lib/pv/actions';
import { CHANNEL_LABELS, PERMISSION_LABELS } from '@/lib/pv/filters';
import { renderTemplate, TEMPLATE_VARIABLES, validateTemplate, type TemplateVars } from '@/lib/pv/templates';
import { campaignSchema, preferenceSchema, templateSchema } from '@/lib/pv/validation';
import type { ActionState } from '@/lib/actions/result';
import { ContactStatusBadge, MemberBadge, exclusionLabel } from './badges';

const CHANNEL_OPTIONS: Opt[] = Object.entries(CHANNEL_LABELS).map(([value, label]) => ({ value, label }));
export type TemplateOption = { id: string; name: string; channel: string; subject: string | null; body: string };

type CampaignInput = { name: string; description: string; objective: string; channel: 'phone' | 'whatsapp' | 'email'; segment_id: string; owner_id: string; message_subject: string; message_body: string; observation_days: string };

export function CampaignForm({ id, initial, segments, people, templates }: { id?: string; initial?: CampaignInput; segments: Opt[]; people: Opt[]; templates: TemplateOption[] }) {
  const router = useRouter();
  const { form, state, pending, submit } = useActionForm({
    schema: campaignSchema,
    defaultValues: initial ?? { name: '', description: '', objective: '', channel: 'whatsapp', segment_id: '', owner_id: '', message_subject: '', message_body: '', observation_days: '30' },
    action: (v: CampaignInput) => saveCampaign(id ?? null, v),
    onSuccess: (r) => { if (!id && r.id) router.push(`/campanhas/${r.id}`); },
  });
  const body = form.watch('message_body');
  const errors = body ? validateTemplate(body) : [];
  return (
    <FormShell onSubmit={submit} pending={pending} state={state} submitLabel={id ? 'Salvar campanha' : 'Criar campanha'}>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField form={form} name="name" label="Nome da campanha" maxLength={120} />
        <SelectField form={form} name="channel" label="Canal de contato (manual)" options={CHANNEL_OPTIONS} hint="O sistema não envia nada: a equipe faz o contato e registra o resultado." />
        <SelectField form={form} name="segment_id" label="Público (segmento)" empty="Escolha um segmento…" options={segments} hint="O público é calculado e congelado ao iniciar. Só entra quem tem permissão de contato registrada." />
        <SelectField form={form} name="owner_id" label="Responsável pela campanha" empty="Sem responsável" options={people} />
        <TextField form={form} name="observation_days" label="Janela de observação (dias)" inputMode="numeric" hint="Recompras até X dias depois do primeiro contato contam como resultado observado." />
        <TextField form={form} name="objective" label="Objetivo" maxLength={300} />
      </div>
      <TextAreaField form={form} name="description" label="Descrição" maxLength={1000} />
      <fieldset className="space-y-3 rounded-md border border-border p-3">
        <legend className="px-1 text-sm font-medium">Mensagem de apoio</legend>
        {templates.length ? (
          <Field label="Começar de um modelo" name="tpl">
            <Select id="tpl" defaultValue="" onChange={(e) => { const t = templates.find((x) => x.id === e.target.value); if (t) { form.setValue('message_body', t.body, { shouldDirty: true }); form.setValue('message_subject', t.subject ?? '', { shouldDirty: true }); } }}>
              <option value="">Selecione para preencher…</option>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.name} ({CHANNEL_LABELS[t.channel as keyof typeof CHANNEL_LABELS] ?? t.channel})</option>)}
            </Select>
          </Field>
        ) : null}
        <TextField form={form} name="message_subject" label="Assunto (e-mail)" maxLength={200} />
        <TextAreaField form={form} name="message_body" label="Texto" maxLength={4000} hint={`Variáveis: ${TEMPLATE_VARIABLES.map((v) => `{{${v.key}}}`).join(' ')}. Use {{nome|cliente}} para um valor padrão.`} />
        {errors.length ? <Alert tone="warning">{errors.join(' ')}</Alert> : null}
      </fieldset>
    </FormShell>
  );
}

const TRANSITIONS: Record<string, Array<{ to: string; label: string; confirm?: string; variant?: 'primary' | 'secondary' | 'danger' }>> = {
  draft: [{ to: 'planned', label: 'Marcar como planejada', variant: 'secondary' }, { to: 'running', label: 'Iniciar campanha', variant: 'primary', confirm: 'Iniciar a campanha? O público fica congelado.' }, { to: 'cancelled', label: 'Cancelar', variant: 'danger', confirm: 'Cancelar esta campanha?' }],
  planned: [{ to: 'running', label: 'Iniciar campanha', variant: 'primary', confirm: 'Iniciar a campanha? O público fica congelado.' }, { to: 'draft', label: 'Voltar a rascunho', variant: 'secondary' }, { to: 'cancelled', label: 'Cancelar', variant: 'danger', confirm: 'Cancelar esta campanha?' }],
  running: [{ to: 'paused', label: 'Pausar', variant: 'secondary' }, { to: 'completed', label: 'Concluir', variant: 'primary', confirm: 'Concluir a campanha? Os resultados observados são consolidados.' }, { to: 'cancelled', label: 'Cancelar', variant: 'danger', confirm: 'Cancelar esta campanha?' }],
  paused: [{ to: 'running', label: 'Retomar', variant: 'primary' }, { to: 'completed', label: 'Concluir', variant: 'secondary', confirm: 'Concluir a campanha?' }, { to: 'cancelled', label: 'Cancelar', variant: 'danger', confirm: 'Cancelar esta campanha?' }],
};

export function CampaignControls({ id, status, hasSegment }: { id: string; status: string; hasSegment: boolean }) {
  const options = TRANSITIONS[status] ?? [];
  const canSnapshot = (status === 'draft' || status === 'planned') && hasSegment;
  return (
    <div className="flex flex-wrap items-start gap-2">
      {canSnapshot ? <ActionButton label="Calcular público" pendingLabel="Calculando…" action={() => snapshotCampaign(id)} /> : null}
      {options.map((o) => <ActionButton key={o.to} label={o.label} variant={o.variant} confirm={o.confirm} action={() => setCampaignStatus(id, o.to)} />)}
    </div>
  );
}

type MemberRow = { id: string; customer_id: string; customer_name: string; status: string; exclusion_reason: string | null; contacts: Array<{ id: string; contact_status: 'planned' | 'contacted' | 'responded' | 'no_response' | 'refused'; contacted_at: string | null; notes: string | null }>; vars: TemplateVars };

export function MembersPanel({ campaignId, rows, body, subject, running, canWrite, channel }: { campaignId: string; rows: MemberRow[]; body: string; subject: string | null; running: boolean; canWrite: boolean; channel: string }) {
  const [filter, setFilter] = useState<'all' | 'eligible' | 'excluded'>('all');
  const shown = rows.filter((r) => (filter === 'all' ? true : filter === 'excluded' ? r.status === 'excluded' : r.status !== 'excluded'));
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="Filtrar público">
        {([['all', 'Todos'], ['eligible', 'No público'], ['excluded', 'Fora do público']] as const).map(([k, l]) => (
          <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)} className={`inline-flex min-h-9 items-center rounded-full border px-3 text-xs font-medium ${filter === k ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:bg-black/5 dark:hover:bg-white/5'}`}>{l} ({k === 'all' ? rows.length : rows.filter((r) => (k === 'excluded') === (r.status === 'excluded')).length})</button>
        ))}
      </div>
      {shown.length === 0 ? <p className="text-sm text-muted">Nenhum cliente nesta visão.</p> : (
        <ul className="divide-y divide-border">
          {shown.map((r) => <MemberItem key={r.id} campaignId={campaignId} row={r} body={body} subject={subject} running={running} canWrite={canWrite} channel={channel} />)}
        </ul>
      )}
    </div>
  );
}

function MemberItem({ campaignId, row, body, subject, running, canWrite, channel }: { campaignId: string; row: MemberRow; body: string; subject: string | null; running: boolean; canWrite: boolean; channel: string }) {
  const router = useRouter();
  const [status, setStatus] = useState('contacted');
  const [notes, setNotes] = useState('');
  const [msg, setMsg] = useState<ActionState>({});
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();
  const excluded = row.status === 'excluded';
  const rendered = useMemo(() => (body ? renderTemplate(body, row.vars) : null), [body, row.vars]);
  async function copy() {
    if (!rendered) return;
    try {
      await navigator.clipboard.writeText(subject && channel === 'email' ? `${renderTemplate(subject, row.vars).text}\n\n${rendered.text}` : rendered.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { setMsg({ ok: false, message: 'Não foi possível copiar. Selecione o texto manualmente.' }); }
  }
  return (
    <li className="py-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <a className="font-medium underline-offset-2 hover:underline" href={`/clientes/${row.customer_id}`}>{row.customer_name}</a>
          <MemberBadge status={row.status} />
          {excluded ? <span className="text-xs text-muted">{exclusionLabel(row.exclusion_reason)}</span> : null}
        </div>
        {!excluded && rendered ? <Button type="button" variant="ghost" onClick={copy}>{copied ? 'Copiado!' : 'Copiar mensagem'}</Button> : null}
      </div>
      {row.contacts.length ? (
        <ul className="mt-1 space-y-1 text-xs text-muted">
          {row.contacts.map((c) => <li key={c.id} className="flex flex-wrap items-center gap-2"><ContactStatusBadge status={c.contact_status} />{c.contacted_at ? new Date(c.contacted_at).toLocaleDateString('pt-BR') : ''}{c.notes ? ` · ${c.notes}` : ''}</li>)}
        </ul>
      ) : null}
      {rendered && rendered.missing.length > 0 && !excluded ? <p className="mt-1 text-xs text-warning">Faltam dados para: {rendered.missing.map((m) => `{{${m}}}`).join(', ')}. Confira a mensagem antes de usar.</p> : null}
      {!excluded && canWrite && running ? (
        <form className="mt-2 flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); start(async () => { const r = await logCampaignContact(campaignId, row.customer_id, { status, notes }); setMsg(r); if (r.ok) { setNotes(''); router.refresh(); } }); }}>
          <div><label className="mb-1 block text-xs text-muted" htmlFor={`st-${row.id}`}>Resultado do contato</label>
            <Select id={`st-${row.id}`} className="w-44" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="contacted">Contatado</option><option value="responded">Respondeu</option><option value="no_response">Sem resposta</option><option value="refused">Recusou (não contatar mais)</option><option value="planned">Planejado</option>
            </Select></div>
          <div className="min-w-48 flex-1"><label className="mb-1 block text-xs text-muted" htmlFor={`nt-${row.id}`}>Observações</label><Input id={`nt-${row.id}`} value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)} /></div>
          <Button type="submit" variant="secondary" disabled={pending}>{pending ? '…' : 'Registrar contato'}</Button>
        </form>
      ) : null}
      {msg.message ? <p role={msg.ok ? 'status' : 'alert'} className={`mt-1 text-xs ${msg.ok ? 'text-success' : 'text-danger'}`}>{msg.message}</p> : null}
    </li>
  );
}

// ---------------------------------------------------------------- modelos de mensagem
const SAMPLE: TemplateVars = { nome: 'Maria Souza', primeiro_nome: 'Maria', empresa: 'Mercearia Souza', ultima_compra: '05/06/2026', dias_sem_comprar: '120', produto: 'Café 500g', vendedor: 'Carlos' };

export function TemplateForm({ id, initial }: { id?: string; initial?: { name: string; channel: 'phone' | 'whatsapp' | 'email'; subject: string; body: string; active: boolean } }) {
  const router = useRouter();
  const { form, state, pending, submit } = useActionForm({
    schema: templateSchema,
    defaultValues: initial ?? { name: '', channel: 'whatsapp', subject: '', body: '', active: true },
    action: (v: { name: string; channel: 'phone' | 'whatsapp' | 'email'; subject: string; body: string; active: boolean }) => saveTemplate(id ?? null, v),
    resetOnSuccess: !id,
    onSuccess: () => router.refresh(),
  });
  const body = form.watch('body');
  const preview = body ? renderTemplate(body, SAMPLE).text : '';
  return (
    <FormShell onSubmit={submit} pending={pending} state={state} submitLabel={id ? 'Salvar modelo' : 'Criar modelo'}>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField form={form} name="name" label="Nome do modelo" maxLength={120} />
        <SelectField form={form} name="channel" label="Canal" options={CHANNEL_OPTIONS} />
      </div>
      <TextField form={form} name="subject" label="Assunto (e-mail)" maxLength={200} />
      <TextAreaField form={form} name="body" label="Texto" maxLength={4000} hint={`Variáveis: ${TEMPLATE_VARIABLES.map((v) => `{{${v.key}}}`).join(' ')}. Use {{nome|cliente}} para um valor padrão.`} />
      {preview ? <p className="whitespace-pre-wrap break-words rounded-md border border-border bg-black/5 p-3 text-sm dark:bg-white/5"><span className="mb-1 block text-xs font-medium text-muted">Exemplo com dados fictícios</span>{preview}</p> : null}
      <CheckField form={form} name="active" label="Modelo ativo" />
    </FormShell>
  );
}

export function DeleteTemplateButton({ id }: { id: string }) {
  return <ActionButton label="Excluir" variant="ghost" action={() => deleteTemplate(id)} confirm="Excluir este modelo? Campanhas que já usam o texto não são afetadas." />;
}

// ---------------------------------------------------------------- permissão em lote (LGPD)
export function BulkPreferenceForm() {
  const { form, state, pending, submit } = useActionForm({
    schema: preferenceSchema,
    defaultValues: { channel: 'whatsapp' as const, status: 'legitimate_interest' as const, basis: '' },
    action: (v: { channel: 'phone' | 'whatsapp' | 'email'; status: 'granted' | 'legitimate_interest' | 'denied'; basis: string }) => setPreferenceBulk(v),
  });
  return (
    <FormShell onSubmit={submit} pending={pending} state={state} submitLabel="Aplicar aos clientes sem preferência">
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField form={form} name="channel" label="Canal" options={CHANNEL_OPTIONS} />
        <SelectField form={form} name="status" label="Permissão" options={Object.entries(PERMISSION_LABELS).map(([value, label]) => ({ value, label }))} />
      </div>
      <TextField form={form} name="basis" label="Base legal / referência" maxLength={300} hint="Ex.: «contrato de fornecimento vigente (legítimo interesse)». Fica registrada em cada cliente." />
      <Alert tone="warning">Use só se a empresa tiver base legal para esse contato (LGPD, art. 7º). Vale apenas para clientes <strong>sem</strong> preferência registrada no canal, não altera quem já escolheu e não alcança arquivados nem anonimizados. Quem está na lista de supressão continua bloqueado. A base legal é obrigatória e a ação fica no registro de auditoria.</Alert>
    </FormShell>
  );
}

export { Badge, Textarea };
