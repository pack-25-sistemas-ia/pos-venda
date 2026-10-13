'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Alert, Button, Field, Input, Select } from '@/components/ui/primitives';
import { previewSegment, saveSegment } from '@/lib/pv/actions';
import { CUSTOMER_STATES, STATE_LABELS } from '@/lib/pv/filters';
import { SEGMENT_LABELS, SEGMENTS } from '@/lib/pv/rfm';
import { defaultCondition, describeCriteria, SEGMENT_FIELDS, validateCriteria, type Condition, type Criteria } from '@/lib/pv/segments';
import type { ActionState } from '@/lib/actions/result';

type Opt = { value: string; label: string };

function ValueInput({ cond, onChange, sellers }: { cond: Condition; onChange: (c: Condition) => void; sellers: Opt[] }) {
  const def = SEGMENT_FIELDS.find((f) => f.field === cond.field);
  if (!def) return null;
  const set = (value: unknown) => onChange({ ...cond, value });
  const id = `v-${cond.field}`;
  switch (def.kind) {
    case 'number':
      return <Input id={id} aria-label="Valor" type="number" inputMode="numeric" min={0} value={typeof cond.value === 'number' ? cond.value : ''} onChange={(e) => set(e.target.value === '' ? undefined : Number(e.target.value))} />;
    case 'money':
      return <Input id={id} aria-label="Valor em reais" type="number" inputMode="decimal" min={0} step="0.01" value={typeof cond.value === 'number' ? cond.value / 100 : ''} onChange={(e) => set(e.target.value === '' ? undefined : Math.round(Number(e.target.value) * 100))} />;
    case 'date':
      return <Input id={id} aria-label="Data" type="date" value={typeof cond.value === 'string' ? cond.value : ''} onChange={(e) => set(e.target.value)} />;
    case 'category':
      return <Input id={id} aria-label="Categoria" maxLength={80} value={typeof cond.value === 'string' ? cond.value : ''} onChange={(e) => set(e.target.value)} placeholder="Ex.: Bebidas" />;
    case 'segments': {
      const picked = Array.isArray(cond.value) ? (cond.value as string[]) : [];
      return (
        <fieldset className="flex flex-wrap gap-x-4 gap-y-1">
          <legend className="sr-only">Segmentos RFM</legend>
          {SEGMENTS.map((s) => (
            <label key={s} className="flex items-center gap-1 text-sm">
              <input type="checkbox" className="size-4" checked={picked.includes(s)} onChange={(e) => set(e.target.checked ? [...picked, s] : picked.filter((x) => x !== s))} />
              {SEGMENT_LABELS[s]}
            </label>
          ))}
        </fieldset>
      );
    }
    case 'state':
      return cond.op === 'in' ? (
        <fieldset className="flex flex-wrap gap-x-4 gap-y-1">
          <legend className="sr-only">Situações</legend>
          {CUSTOMER_STATES.map((s) => {
            const picked = Array.isArray(cond.value) ? (cond.value as string[]) : [];
            return <label key={s} className="flex items-center gap-1 text-sm"><input type="checkbox" className="size-4" checked={picked.includes(s)} onChange={(e) => set(e.target.checked ? [...picked, s] : picked.filter((x) => x !== s))} />{STATE_LABELS[s]}</label>;
          })}
        </fieldset>
      ) : (
        <Select id={id} aria-label="Situação" value={typeof cond.value === 'string' ? cond.value : 'at_risk'} onChange={(e) => set(e.target.value)}>
          {CUSTOMER_STATES.map((s) => <option key={s} value={s}>{STATE_LABELS[s]}</option>)}
        </Select>
      );
    case 'seller':
      return cond.op === 'eq' ? (
        <Select id={id} aria-label="Responsável" value={typeof cond.value === 'string' ? cond.value : ''} onChange={(e) => set(e.target.value)}>
          <option value="">Selecione…</option>
          {sellers.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </Select>
      ) : null;
    case 'channel':
      return (
        <Select id={id} aria-label="Canal" value={typeof cond.value === 'string' ? cond.value : 'whatsapp'} onChange={(e) => set(e.target.value)}>
          <option value="phone">Telefone</option><option value="whatsapp">WhatsApp</option><option value="email">E-mail</option>
        </Select>
      );
    default:
      return null;
  }
}

/** Construtor de segmentos: campos e operadores de uma lista fechada, sem SQL livre. A validação definitiva é do banco. */
export function SegmentBuilder({ id, initialName, initialDescription, initialCriteria, sellers, readOnly }: { id: string | null; initialName: string; initialDescription: string; initialCriteria: Criteria; sellers: Opt[]; readOnly?: boolean }) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [criteria, setCriteria] = useState<Criteria>(initialCriteria);
  const [msg, setMsg] = useState<ActionState>({});
  const [count, setCount] = useState<number | null>(null);
  const [pending, start] = useTransition();
  const errors = validateCriteria(criteria);
  const update = (i: number, c: Condition) => { setCriteria((cr) => ({ ...cr, conditions: cr.conditions.map((x, k) => (k === i ? c : x)) })); setCount(null); };

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await saveSegment(id, { name, description, criteria });
          setMsg(r);
          if (r.ok) { router.push('/segmentacao'); router.refresh(); }
        });
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nome do segmento" name="seg-name"><Input id="seg-name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} disabled={readOnly} required /></Field>
        <Field label="Descrição" name="seg-desc"><Input id="seg-desc" value={description} maxLength={600} onChange={(e) => setDescription(e.target.value)} disabled={readOnly} /></Field>
      </div>

      <fieldset className="space-y-3 rounded-md border border-border p-3" disabled={readOnly}>
        <legend className="px-1 text-sm font-medium">Condições</legend>
        <div className="flex items-center gap-2 text-sm">
          <span>O cliente entra quando atende</span>
          <Select aria-label="Combinação" className="w-44" value={criteria.match} onChange={(e) => { setCriteria({ ...criteria, match: e.target.value as 'all' | 'any' }); setCount(null); }}>
            <option value="all">a todas as condições</option>
            <option value="any">a qualquer condição</option>
          </Select>
        </div>
        {criteria.conditions.map((cond, i) => {
          const def = SEGMENT_FIELDS.find((f) => f.field === cond.field);
          return (
            <div key={i} className="grid gap-2 rounded-md bg-black/5 p-2 dark:bg-white/5 sm:grid-cols-[1.4fr_1fr_2fr_auto] sm:items-start">
              <Select aria-label={`Campo da condição ${i + 1}`} value={cond.field} onChange={(e) => update(i, defaultCondition(e.target.value))}>
                {SEGMENT_FIELDS.map((f) => <option key={f.field} value={f.field}>{f.label}</option>)}
              </Select>
              <Select aria-label={`Operador da condição ${i + 1}`} value={cond.op} onChange={(e) => { const op = e.target.value; update(i, def?.kind === 'state' && op === 'in' ? { ...cond, op, value: [] } : def?.kind === 'state' ? { ...cond, op, value: 'at_risk' } : { ...cond, op }); }}>
                {def?.ops.map((o) => <option key={o.op} value={o.op}>{o.label}</option>)}
              </Select>
              <div><ValueInput cond={cond} onChange={(c) => update(i, c)} sellers={sellers} /></div>
              <Button type="button" variant="ghost" onClick={() => { setCriteria((cr) => ({ ...cr, conditions: cr.conditions.filter((_, k) => k !== i) })); setCount(null); }} aria-label={`Remover condição ${i + 1}`}>Remover</Button>
            </div>
          );
        })}
        {criteria.conditions.length < 10 ? <Button type="button" variant="secondary" onClick={() => { setCriteria((cr) => ({ ...cr, conditions: [...cr.conditions, defaultCondition('days_since_last')] })); setCount(null); }}>Adicionar condição</Button> : null}
      </fieldset>

      <p className="rounded-md border border-border p-3 text-sm"><span className="font-medium">Em português: </span>{errors.length ? 'complete as condições para ver a descrição.' : describeCriteria(criteria, new Map(sellers.map((s) => [s.value, s.label])))}</p>
      {errors.length > 0 ? <Alert tone="warning"><ul className="list-disc pl-5">{errors.map((e) => <li key={e}>{e}</li>)}</ul></Alert> : null}
      {msg.message ? <Alert tone={msg.ok ? 'success' : 'error'}>{msg.message}</Alert> : null}
      {count !== null ? <Alert tone="info">{count} cliente(s) atendem a estes critérios hoje.</Alert> : null}

      {readOnly ? <p className="text-sm text-muted">Segmentos do sistema não podem ser editados. Duplique as condições em um novo segmento se precisar de uma variação.</p> : (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" disabled={pending || errors.length > 0} onClick={() => start(async () => { const r = await previewSegment(criteria); setMsg(r.ok ? {} : r); setCount(r.ok ? r.count ?? 0 : null); })}>Ver quantos clientes entram</Button>
          <Button type="submit" disabled={pending || errors.length > 0 || name.trim().length < 2}>{pending ? 'Salvando…' : id ? 'Salvar segmento' : 'Criar segmento'}</Button>
        </div>
      )}
    </form>
  );
}
