'use client';

import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatBRL, formatBRLCompact, formatPct } from '@/lib/pv/format';
import type { CampaignChartRow, CohortRow, NamedRow, PeriodRow, SegmentChartRow, SellerChartRow, StateChartRow } from '@/lib/pv/chart-rows';

// Dados já preparados no servidor (rótulos legíveis, valores em reais). Todos os valores vêm do banco; nada é fixo.
const STATE_COLOR: Record<string, string> = { active: '#047857', at_risk: '#d97706', inactive: '#b91c1c', no_purchases: '#94a3b8' };
const SEGMENT_COLOR: Record<string, string> = {
  campeoes: '#047857', fieis: '#0891b2', novos: '#6366f1', promissores: '#7c3aed', atencao: '#d97706', em_risco: '#ea580c', inativos: '#b91c1c', sem_compras: '#94a3b8',
};
const TICK = { fill: 'currentColor', fontSize: 12 };
const TOOLTIP = { background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--foreground)' };
const brl = (v: unknown) => formatBRL(Math.round(Number(v) * 100));
const brlAxis = (v: unknown) => formatBRLCompact(Math.round(Number(v) * 100));

function ChartFrame({ title, description, empty, children, table }: { title: string; description: string; empty: boolean; children: React.ReactNode; table: React.ReactNode }) {
  return (
    <section className="min-w-0 rounded-lg border border-border bg-card p-4 shadow-sm" aria-label={title}>
      <h3 className="text-base font-semibold">{title}</h3>
      <p className="mb-3 text-xs text-muted">{description}</p>
      {empty ? (
        <p className="flex h-[260px] items-center justify-center rounded-md border border-dashed border-border text-sm text-muted">Sem dados no período selecionado</p>
      ) : (
        <div className="h-[260px] w-full text-muted">{children}</div>
      )}
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-muted">Ver dados em tabela</summary>
        <div className="mt-2 overflow-x-auto">{table}</div>
      </details>
    </section>
  );
}

const TH = 'px-2 py-1 text-left font-medium text-muted';
const TD = 'px-2 py-1 tabular-nums';
const Table = ({ caption, head, children }: { caption: string; head: string[]; children: React.ReactNode }) => (
  <table className="w-full text-xs"><caption className="sr-only">{caption}</caption><thead><tr>{head.map((h) => <th key={h} className={TH}>{h}</th>)}</tr></thead><tbody>{children}</tbody></table>
);
const Grid = () => <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.2} />;

/** 1 — Receita ao longo do tempo (primeira compra × recompra). */
export function RevenueChart({ rows }: { rows: PeriodRow[] }) {
  return (
    <ChartFrame title="Receita no período" description="Receita líquida (compras válidas, já descontados estornos) separada em clientes novos e recompra de quem já havia comprado."
      empty={rows.every((r) => r.revenue === 0)}
      table={<Table caption="Receita por período" head={['Período', 'Receita', 'Recompra', 'Pedidos']}>{rows.map((r) => <tr key={r.label}><td className={TD}>{r.label}</td><td className={TD}>{brl(r.revenue)}</td><td className={TD}>{brl(r.repeat)}</td><td className={TD}>{r.orders}</td></tr>)}</Table>}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <Grid />
          <XAxis dataKey="label" tick={TICK} />
          <YAxis tick={TICK} width={72} tickFormatter={brlAxis} />
          <Tooltip formatter={brl} contentStyle={TOOLTIP} />
          <Legend />
          <Bar dataKey="first" name="Primeira compra" stackId="a" fill="#64748b" />
          <Bar dataKey="repeat" name="Recompra" stackId="a" fill="#0891b2" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

/** 2 — Ticket médio ao longo do tempo. */
export function TicketChart({ rows }: { rows: PeriodRow[] }) {
  return (
    <ChartFrame title="Ticket médio" description="Receita ÷ pedidos válidos em cada período. Período sem pedidos não tem ticket."
      empty={rows.every((r) => r.ticket === null)}
      table={<Table caption="Ticket médio por período" head={['Período', 'Pedidos', 'Ticket médio']}>{rows.map((r) => <tr key={r.label}><td className={TD}>{r.label}</td><td className={TD}>{r.orders}</td><td className={TD}>{r.ticket === null ? '—' : brl(r.ticket)}</td></tr>)}</Table>}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <Grid />
          <XAxis dataKey="label" tick={TICK} />
          <YAxis tick={TICK} width={72} tickFormatter={brlAxis} />
          <Tooltip formatter={brl} contentStyle={TOOLTIP} />
          <Line type="monotone" dataKey="ticket" name="Ticket médio" stroke="#7c3aed" strokeWidth={2} dot={{ r: 3 }} connectNulls={false} />
        </LineChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

/** 3 — Clientes por segmento RFM. */
export function SegmentChart({ rows }: { rows: SegmentChartRow[] }) {
  return (
    <ChartFrame title="Clientes por segmento RFM" description="Segmento de cada cliente na rodada RFM mais recente (recência, frequência e valor). Muda quando uma nova rodada é calculada."
      empty={rows.every((r) => r.customers === 0)}
      table={<Table caption="Clientes por segmento RFM" head={['Segmento', 'Clientes', 'Valor na janela']}>{rows.map((r) => <tr key={r.key}><td className={TD}>{r.name}</td><td className={TD}>{r.customers}</td><td className={TD}>{brl(r.revenue)}</td></tr>)}</Table>}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.2} horizontal={false} />
          <XAxis type="number" tick={TICK} allowDecimals={false} />
          <YAxis type="category" dataKey="name" tick={TICK} width={120} />
          <Tooltip contentStyle={TOOLTIP} formatter={(v) => `${v} cliente(s)`} />
          <Bar dataKey="customers" name="Clientes" radius={[0, 4, 4, 0]}>
            {rows.map((r) => <Cell key={r.key} fill={SEGMENT_COLOR[r.key] ?? '#64748b'} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

/** 4 — Situação dos clientes. */
export function StateChart({ rows }: { rows: StateChartRow[] }) {
  const visible = rows.filter((r) => r.value > 0);
  return (
    <ChartFrame title="Ativos, em risco e inativos" description="Situação atual de cada cliente pelas regras de risco configuradas (inatividade, ciclo de recompra e queda de frequência)."
      empty={visible.length === 0}
      table={<Table caption="Situação dos clientes" head={['Situação', 'Clientes']}>{rows.map((r) => <tr key={r.key}><td className={TD}>{r.name}</td><td className={TD}>{r.value}</td></tr>)}</Table>}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={visible} dataKey="value" nameKey="name" innerRadius={45} outerRadius={78} paddingAngle={2} isAnimationActive={false}>
            {visible.map((r) => <Cell key={r.key} fill={STATE_COLOR[r.key]} />)}
          </Pie>
          <Tooltip contentStyle={TOOLTIP} />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

/** 5 — Frequência de compra. */
export function FrequencyChart({ rows }: { rows: NamedRow[] }) {
  return (
    <ChartFrame title="Frequência de compra" description="Quantos clientes fizeram 1, 2, 3 a 4 ou 5 ou mais pedidos válidos no período (só quem comprou)."
      empty={rows.every((r) => r.value === 0)}
      table={<Table caption="Clientes por faixa de frequência" head={['Faixa', 'Clientes']}>{rows.map((r) => <tr key={r.name}><td className={TD}>{r.name}</td><td className={TD}>{r.value}</td></tr>)}</Table>}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <Grid />
          <XAxis dataKey="name" tick={TICK} interval={0} />
          <YAxis tick={TICK} allowDecimals={false} width={32} />
          <Tooltip contentStyle={TOOLTIP} formatter={(v) => `${v} cliente(s)`} />
          <Bar dataKey="value" name="Clientes" fill="#162a43" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

/** 6 — Reativações observadas ao longo do tempo. */
export function ReactivationChart({ rows }: { rows: PeriodRow[] }) {
  return (
    <ChartFrame title="Reativações observadas" description="Clientes com oportunidade aberta que fizeram uma nova compra válida em cada período. É o que foi observado: não afirma que uma ação causou a compra."
      empty={rows.every((r) => r.reactivated === 0)}
      table={<Table caption="Reativações observadas por período" head={['Período', 'Clientes reativados']}>{rows.map((r) => <tr key={r.label}><td className={TD}>{r.label}</td><td className={TD}>{r.reactivated}</td></tr>)}</Table>}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <Grid />
          <XAxis dataKey="label" tick={TICK} />
          <YAxis tick={TICK} allowDecimals={false} width={32} />
          <Tooltip contentStyle={TOOLTIP} formatter={(v) => `${v} cliente(s)`} />
          <Bar dataKey="reactivated" name="Reativados" fill="#047857" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

/** 7 — Retenção por coorte de primeira compra (tabela de calor acessível). */
export function CohortChart({ rows }: { rows: CohortRow[] }) {
  const maxOffset = rows.reduce((m, r) => Math.max(m, ...r.cells.map((c) => c.offset)), 0);
  const offsets = Array.from({ length: maxOffset + 1 }, (_, i) => i);
  return (
    <section className="min-w-0 rounded-lg border border-border bg-card p-4 shadow-sm" aria-label="Retenção por coorte">
      <h3 className="text-base font-semibold">Retenção por coorte</h3>
      <p className="mb-3 text-xs text-muted">Dos clientes cuja primeira compra foi em cada mês, quantos % voltaram a comprar nos meses seguintes. Mês 0 é o mês da primeira compra.</p>
      {rows.length < 2 ? (
        <p className="flex h-[260px] items-center justify-center rounded-md border border-dashed border-border px-4 text-center text-sm text-muted">Histórico insuficiente: são necessárias ao menos duas coortes mensais com compras.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <caption className="sr-only">Retenção por coorte mensal de primeira compra</caption>
            <thead>
              <tr><th className={TH}>Coorte</th><th className={TH}>Clientes</th>{offsets.map((o) => <th key={o} className={TH}>Mês {o}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.cohort}>
                  <td className={TD}>{r.cohort.slice(0, 7).split('-').reverse().join('/')}</td>
                  <td className={TD}>{r.size}</td>
                  {offsets.map((o) => {
                    const c = r.cells.find((x) => x.offset === o);
                    return (
                      <td key={o} className={TD} style={c ? { background: `color-mix(in srgb, #0891b2 ${Math.round(Math.min(c.pct, 100) * 0.6)}%, transparent)` } : undefined}>
                        {c ? formatPct(c.pct) : '—'}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** 8 — Resultado das campanhas. */
export function CampaignChart({ rows }: { rows: CampaignChartRow[] }) {
  return (
    <ChartFrame title="Campanhas: contato e recompra" description="Contatados, que responderam e que compraram depois do primeiro contato, dentro da janela de observação (observado, não causal)."
      empty={rows.length === 0 || rows.every((r) => r.contacted === 0)}
      table={<Table caption="Resultado das campanhas" head={['Campanha', 'Contatados', 'Responderam', 'Recompraram']}>{rows.map((r) => <tr key={r.name}><td className={TD}>{r.name}</td><td className={TD}>{r.contacted}</td><td className={TD}>{r.responded}</td><td className={TD}>{r.rebought}</td></tr>)}</Table>}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.2} horizontal={false} />
          <XAxis type="number" tick={TICK} allowDecimals={false} />
          <YAxis type="category" dataKey="name" tick={TICK} width={110} />
          <Tooltip contentStyle={TOOLTIP} />
          <Legend />
          <Bar dataKey="contacted" name="Contatados" fill="#64748b" radius={[0, 4, 4, 0]} />
          <Bar dataKey="responded" name="Responderam" fill="#0891b2" radius={[0, 4, 4, 0]} />
          <Bar dataKey="rebought" name="Recompraram" fill="#047857" radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

/** 9 — Desempenho por responsável. */
export function SellerChart({ rows }: { rows: SellerChartRow[] }) {
  return (
    <ChartFrame title="Reativação por responsável" description="Contatos de campanha feitos e clientes reativados (observado) por responsável da carteira, no período."
      empty={rows.every((r) => r.contacts === 0 && r.reactivated === 0)}
      table={<Table caption="Reativação por responsável" head={['Responsável', 'Contatos', 'Reativados', 'Receita observada']}>{rows.map((r) => <tr key={r.name}><td className={TD}>{r.name}</td><td className={TD}>{r.contacts}</td><td className={TD}>{r.reactivated}</td><td className={TD}>{brl(r.revenue)}</td></tr>)}</Table>}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <Grid />
          <XAxis dataKey="name" tick={TICK} interval={0} />
          <YAxis tick={TICK} allowDecimals={false} width={32} />
          <Tooltip contentStyle={TOOLTIP} />
          <Legend />
          <Bar dataKey="contacts" name="Contatos" fill="#64748b" radius={[4, 4, 0, 0]} />
          <Bar dataKey="reactivated" name="Reativados" fill="#047857" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
