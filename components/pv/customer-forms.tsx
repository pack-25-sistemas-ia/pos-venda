'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useFieldArray } from 'react-hook-form';
import { Alert, Button, Field, Input, Select } from '@/components/ui/primitives';
import { ActionButton, CheckField, FormShell, SelectField, TextAreaField, TextField, useActionForm, type Opt } from '@/components/app/form-kit';
import {
  addActivity, anonymizeCustomer, archiveCustomer, assignCustomer, cancelPurchase, completeActivity, createCustomer, createPurchase, liftSuppression, refundPurchase, setPreference,
  suppressCustomer, updateCustomer,
} from '@/lib/pv/actions';
import { ACTIVITY_LABELS, ACTIVITY_TYPES, CHANNEL_LABELS, PERMISSION_LABELS } from '@/lib/pv/filters';
import { activitySchema, customerSchema, preferenceSchema, purchaseSchema, refundSchema, suppressionSchema } from '@/lib/pv/validation';
import type { ActionState } from '@/lib/actions/result';

const CHANNEL_OPTIONS: Opt[] = Object.entries(CHANNEL_LABELS).map(([value, label]) => ({ value, label }));

type CustomerInput = { name: string; customer_type: 'person' | 'company'; email: string; phone: string; document_number: string; company_name: string; external_customer_id: string; notes: string };
const EMPTY_CUSTOMER: CustomerInput = { name: '', customer_type: 'person', email: '', phone: '', document_number: '', company_name: '', external_customer_id: '', notes: '' };

export function CustomerForm({ id, initial }: { id?: string; initial?: CustomerInput }) {
  const router = useRouter();
  const { form, state, pending, submit } = useActionForm({
    schema: customerSchema,
    defaultValues: initial ?? EMPTY_CUSTOMER,
    action: (v: CustomerInput) => (id ? updateCustomer(id, v) : createCustomer(v)),
    onSuccess: (r) => { if (!id && r.id) router.push(`/clientes/${r.id}`); },
  });
  return (
    <FormShell onSubmit={submit} pending={pending} state={state} submitLabel={id ? 'Salvar alterações' : 'Cadastrar cliente'}>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField form={form} name="name" label="Nome" maxLength={160} />
        <SelectField form={form} name="customer_type" label="Tipo" options={[{ value: 'person', label: 'Pessoa' }, { value: 'company', label: 'Empresa' }]} />
        <TextField form={form} name="email" label="E-mail" type="email" inputMode="email" maxLength={254} />
        <TextField form={form} name="phone" label="Telefone / WhatsApp" type="tel" inputMode="tel" maxLength={30} hint="Com DDD." />
        <TextField form={form} name="document_number" label="CPF / CNPJ" inputMode="numeric" maxLength={24} hint="Opcional. Ajuda a evitar cadastros duplicados." />
        <TextField form={form} name="company_name" label="Empresa" maxLength={160} />
        <TextField form={form} name="external_customer_id" label="Identificador no seu sistema" maxLength={80} hint="Opcional. Também evita duplicidade." />
      </div>
      <TextAreaField form={form} name="notes" label="Observações" maxLength={4000} />
      <p className="text-xs text-muted">Cadastrar um cliente não registra consentimento para contato: a permissão por canal é definida na ficha do cliente.</p>
    </FormShell>
  );
}

export function AssignControl({ id, current, people }: { id: string; current: string | null; people: Opt[] }) {
  const router = useRouter();
  const [value, setValue] = useState(current ?? '');
  const [msg, setMsg] = useState<ActionState>({});
  const [pending, start] = useTransition();
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await assignCustomer(id, value || null);
          setMsg(r);
          if (r.ok) router.refresh();
        });
      }}
    >
      <Field label="Responsável pela carteira" name={`assign-${id}`}>
        <Select id={`assign-${id}`} value={value} onChange={(e) => setValue(e.target.value)}>
          <option value="">Sem responsável</option>
          {people.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </Select>
      </Field>
      {msg.message ? <Alert tone={msg.ok ? 'success' : 'error'}>{msg.message}</Alert> : null}
      <Button type="submit" variant="secondary" disabled={pending || value === (current ?? '')}>{pending ? 'Salvando…' : 'Atribuir'}</Button>
    </form>
  );
}

export function CustomerHeaderActions({ id, archived, anonymized, canManage, canAdmin }: { id: string; archived: boolean; anonymized: boolean; canManage: boolean; canAdmin: boolean }) {
  return (
    <div className="flex flex-wrap items-start gap-2">
      {canManage && !anonymized ? <ActionButton label={archived ? 'Restaurar' : 'Arquivar'} action={() => archiveCustomer(id, !archived)} confirm={archived ? undefined : 'Arquivar este cliente? Ele sai das listas e das campanhas, e o histórico é mantido.'} /> : null}
      {canAdmin && !anonymized ? (
        <ActionButton label="Anonimizar (LGPD)" variant="danger" action={() => anonymizeCustomer(id)} confirm="Remover os dados pessoais deste cliente? Nome, contatos, documento e observações são apagados e não podem ser recuperados. Compras e números agregados são mantidos." />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- preferências de contato e supressão
export function PreferenceForm({ customerId }: { customerId: string }) {
  const { form, state, pending, submit } = useActionForm({
    schema: preferenceSchema,
    defaultValues: { channel: 'whatsapp' as const, status: 'granted' as const, basis: '' },
    action: (v: { channel: 'phone' | 'whatsapp' | 'email'; status: 'granted' | 'legitimate_interest' | 'denied'; basis: string }) => setPreference(customerId, v),
    resetOnSuccess: true,
  });
  return (
    <FormShell onSubmit={submit} pending={pending} state={state} submitLabel="Registrar preferência">
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField form={form} name="channel" label="Canal" options={CHANNEL_OPTIONS} />
        <SelectField form={form} name="status" label="Permissão" options={Object.entries(PERMISSION_LABELS).map(([value, label]) => ({ value, label }))} />
      </div>
      <TextField form={form} name="basis" label="Base legal / referência" maxLength={300} hint="Ex.: «opt-in no cadastro de 12/03/2026» ou «contrato vigente». Obrigatório para consentimento e legítimo interesse." />
      <p className="text-xs text-muted">Sem permissão registrada, o cliente fica fora das campanhas. A ausência de registro nunca vale como consentimento.</p>
    </FormShell>
  );
}

export function SuppressionForm({ customerId }: { customerId: string }) {
  const { form, state, pending, submit } = useActionForm({
    schema: suppressionSchema,
    defaultValues: { channel: '' as const, reason: '' },
    action: (v: { channel: '' | 'phone' | 'whatsapp' | 'email'; reason: string }) => suppressCustomer(customerId, v),
    resetOnSuccess: true,
  });
  return (
    <FormShell onSubmit={submit} pending={pending} state={state} submitLabel="Incluir na lista de supressão">
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField form={form} name="channel" label="Canal" empty="Todos os canais" options={CHANNEL_OPTIONS} />
        <TextField form={form} name="reason" label="Motivo" maxLength={300} />
      </div>
    </FormShell>
  );
}

export function LiftSuppressionButton({ id, customerId }: { id: string; customerId: string }) {
  return <ActionButton label="Levantar" action={() => liftSuppression(id, customerId)} confirm="Levantar esta supressão? O cliente poderá voltar a ser contatado nos canais com permissão registrada." />;
}

// ---------------------------------------------------------------- tarefas
export function ActivityForm({ customerId, people, campaignId, opportunityId }: { customerId: string; people: Opt[]; campaignId?: string; opportunityId?: string }) {
  const { form, state, pending, submit } = useActionForm({
    schema: activitySchema,
    defaultValues: { type: 'follow_up' as const, title: '', description: '', priority: 'normal' as const, assigned_to: '', due_at: '', done: false, campaign_id: campaignId ?? '', opportunity_id: opportunityId ?? '' },
    action: (v: { type: (typeof ACTIVITY_TYPES)[number]; title: string; description: string; priority: 'low' | 'normal' | 'high'; assigned_to: string; due_at: string; done: boolean; campaign_id: string; opportunity_id: string }) => addActivity(customerId, v),
    resetOnSuccess: true,
  });
  return (
    <FormShell onSubmit={submit} pending={pending} state={state} submitLabel="Salvar tarefa">
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField form={form} name="type" label="Tipo" options={ACTIVITY_TYPES.map((t) => ({ value: t, label: ACTIVITY_LABELS[t] }))} />
        <TextField form={form} name="title" label="Título" maxLength={160} />
        <SelectField form={form} name="priority" label="Prioridade" options={[{ value: 'low', label: 'Baixa' }, { value: 'normal', label: 'Normal' }, { value: 'high', label: 'Alta' }]} />
        <TextField form={form} name="due_at" label="Prazo" type="datetime-local" hint="Vazio = sem prazo." />
        {people.length ? <SelectField form={form} name="assigned_to" label="Responsável" empty="Eu" options={people} /> : null}
      </div>
      <TextAreaField form={form} name="description" label="Detalhes" maxLength={2000} />
      <CheckField form={form} name="done" label="Já foi realizada" />
    </FormShell>
  );
}

export function ActivityToggle({ id, customerId, done }: { id: string; customerId: string; done: boolean }) {
  return <ActionButton label={done ? 'Reabrir' : 'Concluir'} pendingLabel="…" action={() => completeActivity(id, customerId, !done)} />;
}

// ---------------------------------------------------------------- compras
type PurchaseFormInput = {
  customer_id: string; date: string; external_order_id: string; total: string; source: string; notes: string; allow_duplicate: boolean;
  items: Array<{ product_name: string; category: string; quantity: string; unit_price: string }>;
};

export function PurchaseForm({ customers, fixedCustomer, today }: { customers: Opt[]; fixedCustomer?: string; today: string }) {
  const router = useRouter();
  const { form, state, pending, submit } = useActionForm({
    schema: purchaseSchema,
    defaultValues: { customer_id: fixedCustomer ?? '', date: today, external_order_id: '', total: '', source: '', notes: '', allow_duplicate: false, items: [] } as PurchaseFormInput,
    action: (v: PurchaseFormInput) => createPurchase(v),
    onSuccess: (r) => { if (r.ok) router.push(fixedCustomer ? `/clientes/${fixedCustomer}` : '/compras'); },
  });
  const items = useFieldArray({ control: form.control, name: 'items' });
  const duplicate = Boolean(state.fieldErrors?._duplicate);
  return (
    <FormShell onSubmit={submit} pending={pending} state={state} submitLabel="Registrar compra">
      <div className="grid gap-4 sm:grid-cols-2">
        {fixedCustomer ? null : <SelectField form={form} name="customer_id" label="Cliente" empty="Selecione…" options={customers} />}
        <TextField form={form} name="date" label="Data da compra" type="date" />
        <TextField form={form} name="external_order_id" label="Número do pedido" maxLength={80} hint="Opcional. Evita registrar o mesmo pedido duas vezes." />
        <TextField form={form} name="total" label="Valor total (R$)" inputMode="decimal" placeholder="1.234,56" hint="Vazio: soma dos itens." />
      </div>
      <fieldset className="space-y-3 rounded-md border border-border p-3">
        <legend className="px-1 text-sm font-medium">Itens (opcional)</legend>
        {items.fields.map((f, i) => (
          <div key={f.id} className="grid gap-3 sm:grid-cols-[2fr_1.2fr_0.8fr_1fr_auto] sm:items-end">
            <TextField form={form} name={`items.${i}.product_name`} label="Produto" maxLength={200} />
            <TextField form={form} name={`items.${i}.category`} label="Categoria" maxLength={80} />
            <TextField form={form} name={`items.${i}.quantity`} label="Qtd." inputMode="decimal" />
            <TextField form={form} name={`items.${i}.unit_price`} label="Preço unit. (R$)" inputMode="decimal" />
            <Button type="button" variant="ghost" onClick={() => items.remove(i)} aria-label={`Remover item ${i + 1}`}>Remover</Button>
          </div>
        ))}
        {items.fields.length < 30 ? <Button type="button" variant="secondary" onClick={() => items.append({ product_name: '', category: '', quantity: '1', unit_price: '' })}>Adicionar item</Button> : null}
      </fieldset>
      <TextAreaField form={form} name="notes" label="Observações" maxLength={1000} />
      {duplicate ? <CheckField form={form} name="allow_duplicate" label="Registrar mesmo assim (já existe compra deste cliente com o mesmo dia e valor)" /> : null}
    </FormShell>
  );
}

export function PurchaseRowActions({ id, customerId, net, valid, canManage }: { id: string; customerId: string; net: number; valid: boolean; canManage: boolean }) {
  const [open, setOpen] = useState(false);
  if (!canManage) return null;
  return (
    <div className="flex flex-wrap items-start gap-2">
      {valid ? <Button type="button" variant="ghost" onClick={() => setOpen((v) => !v)} aria-expanded={open}>Estornar…</Button> : null}
      <ActionButton label="Cancelar compra" variant="ghost" action={() => cancelPurchase(id, customerId)} confirm="Cancelar esta compra? Ela deixa de contar nos indicadores, e reativações ou resultados de campanha ligados a ela são desfeitos." disabled={!valid} />
      {open ? <RefundForm id={id} customerId={customerId} net={net} onDone={() => setOpen(false)} /> : null}
    </div>
  );
}

function RefundForm({ id, customerId, net, onDone }: { id: string; customerId: string; net: number; onDone: () => void }) {
  const { form, state, pending, submit } = useActionForm({
    schema: refundSchema,
    defaultValues: { amount: '' },
    action: (v: { amount: string }) => refundPurchase(id, customerId, v),
    onSuccess: onDone,
  });
  return (
    <div className="w-full max-w-sm">
      <FormShell onSubmit={submit} pending={pending} state={state} submitLabel="Registrar estorno">
        <TextField form={form} name="amount" label="Valor estornado (R$)" inputMode="decimal" hint={`Até ${(net / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} (ainda não estornado).`} />
      </FormShell>
    </div>
  );
}

export { Input };
