'use client';

import Link from 'next/link';
import { useMemo, useState, useTransition } from 'react';
import { Alert, Badge, Button, Card, Input, Select } from '@/components/ui/primitives';
import { runImport, type ImportReport } from '@/lib/pv/actions';
import { MAX_IMPORT_BYTES, MAX_IMPORT_ROWS, parseTable, type ParsedTable } from '@/lib/pv/csv';
import { buildRows, CUSTOMER_FIELDS, mappingProblems, PURCHASE_FIELDS, suggestMapping, type Mapping } from '@/lib/pv/import';

type Kind = 'customers' | 'purchases';
const MAX_PAYLOAD = 900_000; // limite do corpo de uma Server Action é 1 MB: avisa antes de enviar

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Assistente de importação (CSV): arquivo → mapeamento de colunas → validação (nada é gravado) → importação.
 * A prévia e a gravação usam o MESMO caminho no banco; a prévia só desfaz tudo no fim.
 */
export function ImportWizard({ kind, doneHref, doneLabel, history }: { kind: Kind; doneHref: string; doneLabel: string; history: Array<{ id: string; file_name: string; created_at: string; accepted_rows: number; rejected_rows: number; duplicate_rows: number; status: string }> }) {
  const fields = kind === 'customers' ? CUSTOMER_FIELDS : PURCHASE_FIELDS;
  const [fileName, setFileName] = useState('');
  const [hash, setHash] = useState('');
  const [table, setTable] = useState<Extract<ParsedTable, { ok: true }> | null>(null);
  const [mapping, setMapping] = useState<Mapping>({});
  const [createMissing, setCreateMissing] = useState(false);
  const [readError, setReadError] = useState('');
  const [report, setReport] = useState<ImportReport | null>(null);
  const [validated, setValidated] = useState(false);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();

  const problems = useMemo(() => (table ? mappingProblems(mapping, fields, kind) : []), [table, mapping, fields, kind]);
  const built = useMemo(() => (table ? buildRows(table.rows, mapping, fields) : null), [table, mapping, fields]);

  async function onFile(file: File | undefined) {
    setReport(null); setValidated(false); setDone(false); setReadError(''); setTable(null);
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) { setReadError('Arquivo muito grande (máximo de 2 MB).'); return; }
    const text = await file.text();
    const parsed = parseTable(text);
    if (!parsed.ok) { setReadError(parsed.error); return; }
    setFileName(file.name);
    setHash(await sha256(text));
    setTable(parsed);
    setMapping(suggestMapping(parsed.headers, fields));
  }

  function send(apply: boolean) {
    if (!table || !built) return;
    const payload = { kind, fileName, hash, apply, createMissing, mapping, rows: built.rows };
    if (JSON.stringify(payload).length > MAX_PAYLOAD) { setReport({ ok: false, message: 'O arquivo é grande demais para enviar de uma vez. Divida-o em partes menores e importe uma de cada vez.' }); return; }
    start(async () => {
      const r = await runImport(payload);
      setReport(r);
      if (r.ok && r.preview) setValidated(true);
      if (r.ok && !r.preview) setDone(true);
      if (!r.ok) setValidated(false);
    });
  }

  const blockers = problems.length > 0;
  return (
    <div className="space-y-4">
      <Card title="1. Escolha o arquivo" description={`CSV (separador «;», «,» ou TAB), até ${MAX_IMPORT_ROWS.toLocaleString('pt-BR')} linhas e 2 MB, com a primeira linha de cabeçalho. Exporte do seu sistema ou de uma planilha.`}>
        <label htmlFor="import-file" className="mb-1 block text-sm font-medium">Arquivo CSV</label>
        <Input id="import-file" type="file" accept=".csv,.txt,text/csv,text/plain" onChange={(e) => void onFile(e.target.files?.[0])} />
        {readError ? <div className="mt-3"><Alert tone="error">{readError}</Alert></div> : null}
        {table ? <p className="mt-3 text-sm text-muted">«{fileName}» — {table.rows.length.toLocaleString('pt-BR')} linha(s), {table.headers.length} coluna(s), separador «{table.delimiter === '\t' ? 'TAB' : table.delimiter}».</p> : null}
      </Card>

      {table ? (
        <Card title="2. Relacione as colunas" description="Sugerimos pelo nome do cabeçalho. Confira e ajuste. Campos sem coluna ficam em branco.">
          <div className="grid gap-3 sm:grid-cols-2">
            {fields.map((f) => (
              <div key={f.key}>
                <label htmlFor={`map-${f.key}`} className="mb-1 block text-sm font-medium">{f.label}{f.required ? ' *' : ''}</label>
                <Select id={`map-${f.key}`} value={mapping[f.key] == null ? '' : String(mapping[f.key])} onChange={(e) => { setMapping((m) => ({ ...m, [f.key]: e.target.value === '' ? null : Number(e.target.value) })); setValidated(false); setReport(null); }}>
                  <option value="">— não importar —</option>
                  {table.headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
                </Select>
                {f.hint ? <p className="mt-1 text-xs text-muted">{f.hint}</p> : null}
              </div>
            ))}
          </div>
          {kind === 'purchases' ? (
            <label className="mt-4 flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-0.5 size-4" checked={createMissing} onChange={(e) => { setCreateMissing(e.target.checked); setValidated(false); }} />
              <span>Cadastrar clientes que ainda não existem (exige o nome do cliente e e-mail, CPF/CNPJ ou identificador). Clientes novos ficam <strong>sem permissão de contato</strong> registrada.</span>
            </label>
          ) : null}
          {blockers ? <div className="mt-4"><Alert tone="warning"><ul className="list-disc pl-5">{problems.map((p) => <li key={p}>{p}</li>)}</ul></Alert></div> : null}

          <div className="mt-4 overflow-x-auto">
            <p className="mb-1 text-xs font-medium text-muted">Prévia das 3 primeiras linhas, já convertidas</p>
            <table className="w-full min-w-[32rem] text-xs">
              <thead><tr>{fields.filter((f) => mapping[f.key] != null).map((f) => <th key={f.key} className="px-2 py-1 text-left font-medium text-muted">{f.label}</th>)}</tr></thead>
              <tbody>
                {(built?.rows.slice(0, 3) ?? []).map((r, i) => (
                  <tr key={i} className="border-t border-border">{fields.filter((f) => mapping[f.key] != null).map((f) => <td key={f.key} className="px-2 py-1">{f.kind === 'money' && r[f.out] ? (Number(r[f.out]) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : r[f.out] ?? ''}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
          {built && built.problems.length > 0 ? (
            <div className="mt-4">
              <Alert tone="warning">
                <p className="font-medium">{built.problems.length >= 50 ? 'Pelo menos 50' : built.problems.length} valor(es) não puderam ser convertidos. Essas linhas serão recusadas na validação:</p>
                <ul className="mt-1 list-disc pl-5">{built.problems.slice(0, 8).map((p) => <li key={p}>{p}</li>)}</ul>
              </Alert>
            </div>
          ) : null}
        </Card>
      ) : null}

      {table ? (
        <Card title="3. Valide e importe" description="A validação executa as mesmas regras da importação (duplicidade, cliente existente, valores), mas não grava nada.">
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" disabled={pending || blockers || done} onClick={() => send(false)}>{pending && !validated ? 'Validando…' : 'Validar sem gravar'}</Button>
            <Button type="button" disabled={pending || blockers || !validated || done || (report?.accepted ?? 0) === 0} onClick={() => send(true)}>{pending && validated ? 'Importando…' : 'Importar agora'}</Button>
          </div>
          {!validated && !done ? <p className="mt-2 text-xs text-muted">Valide primeiro para liberar a importação.</p> : null}
          {report ? (
            <div className="mt-4 space-y-3" aria-live="polite">
              <Alert tone={report.ok ? 'success' : 'error'}>{report.message}</Alert>
              {report.alreadyImported ? <Alert tone="warning">Um arquivo idêntico a este já foi importado antes. Pedidos repetidos serão ignorados como duplicados.</Alert> : null}
              {report.total !== undefined ? (
                <dl className="grid gap-2 sm:grid-cols-4 text-sm">
                  <div className="rounded-md border border-border p-2"><dt className="text-xs text-muted">Linhas lidas</dt><dd className="text-lg font-semibold tabular-nums">{report.total}</dd></div>
                  <div className="rounded-md border border-border p-2"><dt className="text-xs text-muted">{report.preview ? 'Prontas' : 'Importadas'}</dt><dd className="text-lg font-semibold tabular-nums">{report.accepted}</dd></div>
                  <div className="rounded-md border border-border p-2"><dt className="text-xs text-muted">Duplicadas</dt><dd className="text-lg font-semibold tabular-nums">{report.duplicates}</dd></div>
                  <div className="rounded-md border border-border p-2"><dt className="text-xs text-muted">Com erro</dt><dd className="text-lg font-semibold tabular-nums">{report.invalid}</dd></div>
                </dl>
              ) : null}
              {report.customersCreated ? <p className="text-sm text-muted">{report.customersCreated} cliente(s) novo(s) {report.preview ? 'seriam cadastrados' : 'cadastrados'} sem permissão de contato.</p> : null}
              {report.lines && report.lines.length > 0 ? (
                <details open>
                  <summary className="cursor-pointer text-sm font-medium">Linhas recusadas ou ignoradas ({report.lines.length}{report.lines.length >= 50 ? '+' : ''})</summary>
                  <ul className="mt-2 max-h-60 list-disc overflow-y-auto pl-5 text-xs">{report.lines.map((l) => <li key={l}>{l}</li>)}</ul>
                </details>
              ) : null}
              {done ? <Link className="inline-flex min-h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90" href={doneHref}>{doneLabel}</Link> : null}
            </div>
          ) : null}
        </Card>
      ) : null}

      <Card title="Importações recentes">
        {history.length === 0 ? <p className="text-sm text-muted">Nenhuma importação ainda.</p> : (
          <ul className="divide-y divide-border text-sm">
            {history.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>{h.file_name} <span className="text-xs text-muted">· {new Date(h.created_at).toLocaleDateString('pt-BR')}</span></span>
                <span className="flex gap-2"><Badge tone="success">{h.accepted_rows} ok</Badge>{h.duplicate_rows ? <Badge tone="warning">{h.duplicate_rows} duplicadas</Badge> : null}{h.rejected_rows ? <Badge tone="danger">{h.rejected_rows} com erro</Badge> : null}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
