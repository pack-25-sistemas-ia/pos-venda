'use client';

import type { ColumnDef } from '@tanstack/react-table';
import Link from 'next/link';
import { DataTable } from '@/components/app/data-table';
import { Badge } from '@/components/ui/primitives';
import type { CustomerListRow, OpportunityListRow, PurchaseListRow } from '@/lib/pv/data';
import { formatBRL, formatDate, formatDateTime, formatDays, formatPhone } from '@/lib/pv/format';
import { OppStatusBadge, PriorityBadge, SegmentBadge, StateBadge, reasonLabel } from './badges';

const dash = <span className="text-muted">—</span>;

export function CustomersTable({ rows, owners, empty }: { rows: CustomerListRow[]; owners: Record<string, string>; empty: React.ReactNode }) {
  const columns: ColumnDef<CustomerListRow, unknown>[] = [
    {
      accessorKey: 'name', header: 'Cliente',
      cell: ({ row }) => (
        <div>
          <Link className="font-medium underline-offset-2 hover:underline" href={`/clientes/${row.original.id}`}>{row.original.name}</Link>
          <div className="text-xs text-muted">{row.original.company_name ?? ''}</div>
        </div>
      ),
    },
    { id: 'contact', header: 'Contato', enableSorting: false, cell: ({ row }) => <div className="text-xs"><div>{row.original.email ?? dash}</div><div className="text-muted">{formatPhone(row.original.phone)}</div></div> },
    { id: 'state', header: 'Situação', accessorFn: (r) => r.signal?.state ?? '', cell: ({ row }) => <StateBadge state={row.original.signal?.state} /> },
    { id: 'segment', header: 'Segmento RFM', accessorFn: (r) => r.segment?.segment_key ?? '', cell: ({ row }) => <SegmentBadge segment={row.original.segment?.segment_key} /> },
    { id: 'last', header: 'Última compra', accessorFn: (r) => r.signal?.last_at ?? '', cell: ({ row }) => <div className="whitespace-nowrap text-xs">{formatDate(row.original.signal?.last_at)}<div className="text-muted">{row.original.signal?.days_since == null ? '' : formatDays(row.original.signal.days_since)}</div></div> },
    { id: 'orders', header: 'Pedidos', accessorFn: (r) => r.signal?.n_valid ?? 0, cell: ({ getValue }) => <span className="tabular-nums">{getValue() as number}</span> },
    { id: 'total', header: 'Total gasto', accessorFn: (r) => r.signal?.net_total_cents ?? 0, cell: ({ getValue }) => <span className="whitespace-nowrap tabular-nums">{formatBRL(getValue() as number)}</span> },
    { id: 'owner', header: 'Responsável', accessorFn: (r) => (r.assigned_to ? owners[r.assigned_to] ?? '' : ''), cell: ({ getValue }) => (getValue() as string) || <span className="text-xs text-warning">Sem responsável</span> },
  ];
  return <DataTable columns={columns} data={rows} caption="Clientes" empty={empty} />;
}

export function PurchasesTable({ rows, timezone, empty }: { rows: PurchaseListRow[]; timezone: string; empty: React.ReactNode }) {
  const columns: ColumnDef<PurchaseListRow, unknown>[] = [
    { accessorKey: 'purchased_at', header: 'Data', cell: ({ getValue }) => <span className="whitespace-nowrap">{formatDateTime(getValue() as string, timezone).slice(0, 10)}</span> },
    { accessorKey: 'customer_name', header: 'Cliente', cell: ({ row }) => <Link className="font-medium underline-offset-2 hover:underline" href={`/clientes/${row.original.customer_id}`}>{row.original.customer_name}</Link> },
    { accessorKey: 'external_order_id', header: 'Pedido', cell: ({ getValue }) => (getValue() as string | null) ?? dash },
    { accessorKey: 'total_cents', header: 'Total', cell: ({ getValue }) => <span className="whitespace-nowrap tabular-nums">{formatBRL(getValue() as number)}</span> },
    { accessorKey: 'refunded_cents', header: 'Estornado', cell: ({ getValue }) => ((getValue() as number) > 0 ? <span className="whitespace-nowrap tabular-nums">{formatBRL(getValue() as number)}</span> : dash) },
    { accessorKey: 'net_cents', header: 'Líquido', cell: ({ getValue }) => <span className="whitespace-nowrap font-medium tabular-nums">{formatBRL(getValue() as number)}</span> },
    {
      id: 'status', header: 'Situação', accessorFn: (r) => (r.is_valid ? 'valid' : r.status),
      cell: ({ row }) => (row.original.status === 'cancelled' ? <Badge tone="danger">Cancelada</Badge> : row.original.is_valid ? <Badge tone="success">Válida</Badge> : <Badge tone="neutral">Estornada</Badge>),
    },
    { accessorKey: 'source', header: 'Origem', cell: ({ getValue }) => <span className="text-xs text-muted">{(getValue() as string | null) ?? '—'}</span> },
  ];
  return <DataTable columns={columns} data={rows} caption="Compras" empty={empty} />;
}

export function OpportunitiesTable({ rows, owners, high, medium, empty }: { rows: OpportunityListRow[]; owners: Record<string, string>; high: number; medium: number; empty: React.ReactNode }) {
  const columns: ColumnDef<OpportunityListRow, unknown>[] = [
    { accessorKey: 'priority', header: 'Prioridade', cell: ({ row }) => <PriorityBadge priority={row.original.priority} high={high} medium={medium} /> },
    {
      accessorKey: 'customer_name', header: 'Cliente',
      cell: ({ row }) => (
        <div>
          <Link className="font-medium underline-offset-2 hover:underline" href={`/clientes/${row.original.customer_id}`}>{row.original.customer_name}</Link>
          <div className="mt-1"><SegmentBadge segment={row.original.segment_key} /></div>
        </div>
      ),
    },
    { accessorKey: 'reason', header: 'Motivo', cell: ({ row }) => <span className="text-xs">{reasonLabel(row.original.reason)}</span> },
    { id: 'days', header: 'Sem comprar', accessorFn: (r) => r.days_since ?? -1, cell: ({ row }) => <span className="whitespace-nowrap text-xs">{row.original.days_since === null ? '—' : formatDays(row.original.days_since)}</span> },
    { id: 'value', header: 'Valor estimado', accessorFn: (r) => r.estimated_value_cents ?? -1, cell: ({ row }) => <span className="whitespace-nowrap tabular-nums">{formatBRL(row.original.estimated_value_cents)}</span> },
    { accessorKey: 'status', header: 'Situação', cell: ({ row }) => <OppStatusBadge status={row.original.status} /> },
    { id: 'owner', header: 'Responsável', accessorFn: (r) => (r.assigned_to ? owners[r.assigned_to] ?? '' : ''), cell: ({ getValue }) => (getValue() as string) || <span className="text-xs text-warning">Sem responsável</span> },
    { id: 'identified', header: 'Identificada em', accessorKey: 'identified_at', cell: ({ getValue }) => <span className="whitespace-nowrap text-muted">{formatDate((getValue() as string).slice(0, 10))}</span> },
    { id: 'detail', header: '', enableSorting: false, cell: ({ row }) => <Link className="text-xs underline" href={`/reativacao/${row.original.id}`}>Ver explicação</Link> },
  ];
  return <DataTable columns={columns} data={rows} caption="Oportunidades de reativação" empty={empty} />;
}

