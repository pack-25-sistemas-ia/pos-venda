'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Alert, Button, Field, Input, Select, Textarea } from '@/components/ui/primitives';
import { ActionButton, type Opt } from '@/components/app/form-kit';
import { opportunityAction } from '@/lib/pv/actions';
import type { ActionState } from '@/lib/actions/result';

function useAct(id: string) {
  const router = useRouter();
  const [msg, setMsg] = useState<ActionState>({});
  const [pending, start] = useTransition();
  const run = (action: string, value?: string, after?: () => void) => start(async () => {
    const r = await opportunityAction(id, { action, value });
    setMsg(r);
    if (r.ok) { after?.(); router.refresh(); }
  });
  return { msg, pending, run };
}

export function OpportunityControls({ id, status, nextAction, assignedTo, people, canManage, canWrite }: { id: string; status: string; nextAction: string | null; assignedTo: string | null; people: Opt[]; canManage: boolean; canWrite: boolean }) {
  const { msg, pending, run } = useAct(id);
  const [next, setNext] = useState(nextAction ?? '');
  const [reason, setReason] = useState('');
  const [owner, setOwner] = useState(assignedTo ?? '');
  const closed = status === 'reactivated' || status === 'discarded';
  if (!canWrite || closed) return <p className="text-sm text-muted">{closed ? 'Oportunidade encerrada.' : 'Somente leitura.'}</p>;
  return (
    <div className="space-y-5">
      {status === 'open' ? <Button type="button" disabled={pending} onClick={() => run('start')}>Iniciar abordagem</Button> : null}

      <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); run('next_action', next); }}>
        <Field label="Próxima ação" name={`next-${id}`}><Input id={`next-${id}`} value={next} maxLength={300} onChange={(e) => setNext(e.target.value)} placeholder="Ex.: ligar na terça, oferecer reposição" /></Field>
        <Button type="submit" variant="secondary" disabled={pending}>Salvar próxima ação</Button>
      </form>

      {canManage ? (
        <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); run('assign', owner); }}>
          <Field label="Responsável" name={`own-${id}`}>
            <Select id={`own-${id}`} value={owner} onChange={(e) => setOwner(e.target.value)}>
              <option value="">Sem responsável</option>
              {people.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </Select>
          </Field>
          <Button type="submit" variant="secondary" disabled={pending || owner === (assignedTo ?? '')}>Atribuir</Button>
        </form>
      ) : null}

      <div className="space-y-2 border-t border-border pt-4">
        <ActionButton label="Confirmar reativação" variant="secondary" action={() => opportunityAction(id, { action: 'reactivated' })} />
        <p className="text-xs text-muted">Só funciona se já existir uma compra válida depois da identificação. Normalmente isso é reconhecido sozinho ao registrar ou importar a compra.</p>
      </div>

      <form className="space-y-2 border-t border-border pt-4" onSubmit={(e) => { e.preventDefault(); if (reason.trim()) run('discard', reason.trim(), () => setReason('')); }}>
        <Field label="Descartar oportunidade" name={`disc-${id}`}><Textarea id={`disc-${id}`} className="min-h-16" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motivo (obrigatório): ex.: cliente encerrou a atividade" /></Field>
        <Button type="submit" variant="danger" disabled={pending || !reason.trim()}>Descartar</Button>
      </form>
      {msg.message ? <Alert tone={msg.ok ? 'success' : 'error'}>{msg.message}</Alert> : null}
    </div>
  );
}
