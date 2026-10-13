'use client';

import { useState } from 'react';
import { Button, Input, Select } from '@/components/ui/primitives';
import { CUSTOMER_STATES, PERIOD_LABELS, PERIODS, SEGMENT_KEYS, STATE_LABELS, type Period, type PvFilters } from '@/lib/pv/filters';
import { SEGMENT_LABELS, type SegmentKey } from '@/lib/pv/rfm';

type Opt = { value: string; label: string };

/** Filtros globais do painel e dos relatórios (período, responsável, segmento RFM, situação, categoria). Envia por GET: a URL é compartilhável. */
export function FilterBar({ action, filters, sellers, categories }: { action: string; filters: PvFilters; sellers?: Opt[]; categories: string[] }) {
  const [period, setPeriod] = useState<Period>(filters.period);
  return (
    <form action={action} method="get" className="mb-6 flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-3" aria-label="Filtros do período">
      <div>
        <label htmlFor="period" className="mb-1 block text-xs font-medium text-muted">Período</label>
        <Select id="period" name="period" value={period} onChange={(e) => setPeriod(e.target.value as Period)} className="w-48">
          {PERIODS.map((p) => <option key={p} value={p}>{PERIOD_LABELS[p]}</option>)}
        </Select>
      </div>
      {period === 'custom' ? (
        <>
          <div>
            <label htmlFor="from" className="mb-1 block text-xs font-medium text-muted">De</label>
            <Input id="from" name="from" type="date" defaultValue={filters.from} required />
          </div>
          <div>
            <label htmlFor="to" className="mb-1 block text-xs font-medium text-muted">Até</label>
            <Input id="to" name="to" type="date" defaultValue={filters.to} required />
          </div>
        </>
      ) : null}
      {sellers ? (
        <div>
          <label htmlFor="seller" className="mb-1 block text-xs font-medium text-muted">Responsável</label>
          <Select id="seller" name="seller" defaultValue={filters.seller ?? ''} className="w-44">
            <option value="">Todos</option>
            {sellers.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        </div>
      ) : null}
      <div>
        <label htmlFor="segment" className="mb-1 block text-xs font-medium text-muted">Segmento RFM</label>
        <Select id="segment" name="segment" defaultValue={filters.segment ?? ''} className="w-44">
          <option value="">Todos</option>
          {SEGMENT_KEYS.map((s) => <option key={s} value={s}>{SEGMENT_LABELS[s as SegmentKey]}</option>)}
        </Select>
      </div>
      <div>
        <label htmlFor="status" className="mb-1 block text-xs font-medium text-muted">Situação</label>
        <Select id="status" name="status" defaultValue={filters.status ?? ''} className="w-36">
          <option value="">Todas</option>
          {CUSTOMER_STATES.map((s) => <option key={s} value={s}>{STATE_LABELS[s]}</option>)}
        </Select>
      </div>
      <div>
        <label htmlFor="category" className="mb-1 block text-xs font-medium text-muted">Categoria</label>
        <Select id="category" name="category" defaultValue={filters.category ?? ''} className="w-40">
          <option value="">Todas</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </Select>
      </div>
      <Button type="submit">Aplicar</Button>
    </form>
  );
}
