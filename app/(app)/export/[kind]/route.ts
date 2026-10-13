import { NextResponse } from 'next/server';
import { resolveContext } from '@/lib/auth/session';
import { MANAGER_ROLES } from '@/lib/pv/access';
import { toCsv, int, money, type CsvCell } from '@/lib/pv/csv';
import { CUSTOMER_COLUMNS, CUSTOMER_LOAD_LIMIT, currentSegments, labelMap, latestRun, loadPeople, loadSettings, loadSignals, searchToken, type CustomerRow } from '@/lib/pv/data';
import { CUSTOMER_STATES, parseFilters, SEGMENT_KEYS, STATE_LABELS, todayIn } from '@/lib/pv/filters';
import { formatDocument, formatPhone } from '@/lib/pv/format';
import { buildReport, REPORT_KEYS, type ReportKey } from '@/lib/pv/reports';
import { SEGMENT_LABELS, type SegmentKey } from '@/lib/pv/rfm';
import { logEvent } from '@/lib/log';

export const runtime = 'nodejs';

function csvResponse(name: string, body: string) {
  return new NextResponse(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${name}.csv"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

/** Exportações em CSV (UTF-8 com BOM, `;`, fórmulas neutralizadas). Só gestão baixa; o RLS limita ao que o usuário enxerga. Cada download vai para a auditoria. */
export async function GET(request: Request, { params }: { params: Promise<{ kind: string }> }) {
  const auth = await resolveContext();
  if (auth.kind !== 'ok') return NextResponse.json({ error: 'Sessão inválida.' }, { status: 401 });
  const { ctx } = auth;
  const org = ctx.membership.organization_id;
  const manager = (MANAGER_ROLES as readonly string[]).includes(ctx.membership.role);
  const { kind } = await params;
  if (!manager) return NextResponse.json({ error: 'Sem permissão.' }, { status: 403 });
  const sp = Object.fromEntries(new URL(request.url).searchParams.entries());
  const settings = await loadSettings(ctx);
  const today = todayIn(settings.timezone);
  const f = parseFilters(sp, today);
  const db = ctx.supabase;

  const audit = async (rows: number) => {
    const { error } = await db.rpc('pv_log_export', { p_org: org, p_kind: kind, p_rows: rows });
    if (error) logEvent('warn', 'pv_export_audit_failed', { kind });
  };

  // Modelos de CSV para a importação (sem dados reais)
  if (kind === 'modelo-clientes') {
    return csvResponse('modelo-clientes', toCsv(['Nome', 'E-mail', 'Telefone', 'CPF/CNPJ', 'Empresa', 'Identificador', 'Tipo'], [['Maria Exemplo', 'maria@exemplo.com.br', '(11) 99999-0000', '', 'Mercearia Exemplo', 'CLI-0001', 'pessoa']]));
  }
  if (kind === 'modelo-compras') {
    return csvResponse('modelo-compras', toCsv(['Pedido', 'Data', 'E-mail do cliente', 'Valor total', 'Status', 'Produto', 'Categoria'], [['PED-0001', '15/08/2026', 'maria@exemplo.com.br', '1.234,56', 'concluída', 'Café 500g', 'Bebidas']]));
  }

  if (kind === 'clientes') {
    const pick = (key: string, allowed: readonly string[]) => (allowed.includes(sp[key] ?? '') ? sp[key]! : '');
    const state = pick('state', CUSTOMER_STATES);
    const segment = pick('segment', SEGMENT_KEYS);
    let q = db.from('customers').select(CUSTOMER_COLUMNS).eq('organization_id', org);
    q = sp.archived === '1' ? q.not('archived_at', 'is', null) : q.is('archived_at', null);
    if (/^[0-9a-f-]{36}$/i.test(sp.seller ?? '')) q = q.eq('assigned_to', sp.seller!);
    if (sp.unassigned === '1') q = q.is('assigned_to', null);
    const term = searchToken(sp.q);
    if (term) q = q.or(`name.ilike.%${term}%,email.ilike.%${term}%,company_name.ilike.%${term}%`);
    const [{ data }, signals, run, people] = await Promise.all([q.order('name').limit(CUSTOMER_LOAD_LIMIT), loadSignals(ctx, today), latestRun(ctx), loadPeople(ctx)]);
    const segs = await currentSegments(ctx, run);
    const labels = labelMap(people);
    const rows = ((data ?? []) as CustomerRow[])
      .filter((c) => (!state || signals.get(c.id)?.state === state) && (!segment || (segs.get(c.id)?.segment_key ?? 'sem_compras') === segment))
      .map((c): CsvCell[] => {
        const s = signals.get(c.id);
        const g = segs.get(c.id);
        return [c.name, c.company_name, c.email, formatPhone(c.phone), formatDocument(c.document_number), s ? STATE_LABELS[s.state] : '', g ? SEGMENT_LABELS[g.segment_key as SegmentKey] ?? g.segment_key : '',
          c.assigned_to ? labels.get(c.assigned_to) ?? '' : '', int(s?.n_valid ?? 0), money(s?.net_total_cents ?? 0), s?.last_at ? s.last_at.split('-').reverse().join('/') : '', s?.days_since == null ? '' : int(s.days_since)];
      });
    await audit(rows.length);
    return csvResponse('clientes', toCsv(['Nome', 'Empresa', 'E-mail', 'Telefone', 'CPF/CNPJ', 'Situação', 'Segmento RFM', 'Responsável', 'Pedidos válidos', 'Total gasto (R$)', 'Última compra', 'Dias sem comprar'], rows));
  }

  if (kind === 'compras') {
    // lista de compras (filtros da tela de compras)
    let q = db.from('purchases').select('customer_id, external_order_id, purchased_at, total_cents, refunded_cents, net_cents, status, is_valid, source').eq('organization_id', org);
    if (sp.status === 'valid') q = q.eq('is_valid', true);
    else if (sp.status === 'cancelled') q = q.eq('status', 'cancelled');
    else if (sp.status === 'refunded') q = q.gt('refunded_cents', 0);
    if (/^[0-9a-f-]{36}$/i.test(sp.cliente ?? '')) q = q.eq('customer_id', sp.cliente!);
    if (/^\d{4}-\d{2}-\d{2}$/.test(sp.from ?? '')) q = q.gte('purchased_at', `${sp.from}T00:00:00-03:00`);
    if (/^\d{4}-\d{2}-\d{2}$/.test(sp.to ?? '')) q = q.lte('purchased_at', `${sp.to}T23:59:59-03:00`);
    const term = searchToken(sp.q);
    if (term) q = q.ilike('external_order_id', `%${term}%`);
    const { data } = await q.order('purchased_at', { ascending: false }).limit(5000);
    const list = (data ?? []) as Array<{ customer_id: string; external_order_id: string | null; purchased_at: string; total_cents: number; refunded_cents: number; net_cents: number; status: string; is_valid: boolean; source: string | null }>;
    const ids = [...new Set(list.map((r) => r.customer_id))].slice(0, 5000);
    const { data: custs } = ids.length ? await db.from('customers').select('id, name').in('id', ids) : { data: [] };
    const names = new Map(((custs ?? []) as Array<{ id: string; name: string }>).map((c) => [c.id, c.name]));
    const fmt = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: settings.timezone });
    const rows = list.map((r): CsvCell[] => [fmt.format(new Date(r.purchased_at)), r.external_order_id, names.get(r.customer_id) ?? '', money(Number(r.total_cents)), money(Number(r.refunded_cents)), money(Number(r.net_cents)),
      r.status === 'cancelled' ? 'Cancelada' : r.is_valid ? 'Válida' : 'Estornada', r.source]);
    await audit(rows.length);
    return csvResponse('compras', toCsv(['Data', 'Pedido', 'Cliente', 'Total (R$)', 'Estornado (R$)', 'Líquido (R$)', 'Situação', 'Origem'], rows));
  }

  if ((REPORT_KEYS as string[]).includes(kind)) {
    const report = await buildReport(ctx, kind as ReportKey, f);
    await audit(report.rows.length);
    return csvResponse(kind, toCsv(report.headers, report.rows));
  }

  return NextResponse.json({ error: 'Relatório desconhecido.' }, { status: 404 });
}
