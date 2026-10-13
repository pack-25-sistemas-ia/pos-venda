'use client';

import { Alert, Card } from '@/components/ui/primitives';
import { CheckField, FormShell, SelectField, TextField, useActionForm } from '@/components/app/form-kit';
import { saveSettings } from '@/lib/pv/actions';
import { settingsSchema } from '@/lib/pv/validation';
import { rfmScores, SEGMENT_LABELS, type RfmLimits } from '@/lib/pv/rfm';
import type { SettingsRow } from '@/lib/pv/data';

type Input = {
  timezone: string; rfm_window_days: string; rfm_mode: 'percentile' | 'fixed'; limits_r: string; limits_f: string; limits_m: string; new_customer_days: string; risk_days: string; inactive_days: string;
  cycle_factor: string; cycle_min_purchases: string; cycle_min_days: string; drop_window_days: string; drop_pct: string; drop_min_prev: string;
  rule_inactivity: boolean; rule_cycle: boolean; rule_drop: boolean; rule_segment_change: boolean; observation_days: string;
  w_value: string; w_frequency: string; w_overdue: string; priority_high: string; priority_medium: string; alert_overdue_tasks: boolean;
};

export function toInput(s: SettingsRow): Input {
  const j = (a: number[]) => a.join(', ');
  return {
    timezone: s.timezone, rfm_window_days: String(s.rfm_window_days), rfm_mode: s.rfm_mode, limits_r: j(s.rfm_limits.r), limits_f: j(s.rfm_limits.f), limits_m: j(s.rfm_limits.m.map((c) => c / 100)),
    new_customer_days: String(s.new_customer_days), risk_days: String(s.risk_days), inactive_days: String(s.inactive_days), cycle_factor: String(s.cycle_factor).replace('.', ','),
    cycle_min_purchases: String(s.cycle_min_purchases), cycle_min_days: String(s.cycle_min_days), drop_window_days: String(s.drop_window_days), drop_pct: String(s.drop_pct), drop_min_prev: String(s.drop_min_prev),
    rule_inactivity: s.rule_inactivity, rule_cycle: s.rule_cycle, rule_drop: s.rule_drop, rule_segment_change: s.rule_segment_change, observation_days: String(s.observation_days),
    w_value: String(s.w_value), w_frequency: String(s.w_frequency), w_overdue: String(s.w_overdue), priority_high: String(s.priority_high), priority_medium: String(s.priority_medium), alert_overdue_tasks: s.alert_overdue_tasks,
  };
}

// o limite de valor é digitado em REAIS e guardado em centavos
const toCents = (v: Input): Input => ({ ...v, limits_m: v.limits_m.split(/[\s,;]+/).filter(Boolean).map((x) => String(Math.round(Number(x.replace(',', '.')) * 100))).join(', ') });

const EXAMPLE = [
  { id: 'A', r: 5, f: 12, m: 1_500_000 }, { id: 'B', r: 20, f: 6, m: 600_000 }, { id: 'C', r: 45, f: 3, m: 150_000 }, { id: 'D', r: 120, f: 2, m: 60_000 }, { id: 'E', r: 300, f: 1, m: 20_000 },
];

/** Simulador: aplica o modo e os limites digitados a cinco clientes de exemplo (mesma lógica do banco, espelhada em TypeScript). */
function Simulator({ mode, r, f, m }: { mode: 'percentile' | 'fixed'; r: string; f: string; m: string }) {
  const parse = (s: string, scale = 1) => s.split(/[\s,;]+/).filter(Boolean).map((x) => Math.round(Number(x.replace(',', '.')) * scale));
  const limits = { r: parse(r), f: parse(f), m: parse(m, 100) };
  const ok = [limits.r, limits.f, limits.m].every((a) => a.length === 4 && a.every(Number.isFinite) && a.every((n, i) => i === 0 || n > (a[i - 1] as number)));
  if (mode === 'fixed' && !ok) return <p className="text-xs text-warning">Informe 4 números crescentes em cada limite para ver a simulação.</p>;
  const scores = rfmScores(EXAMPLE, mode, ok ? (limits as RfmLimits) : undefined);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[26rem] text-xs">
        <caption className="mb-1 text-left text-muted">Simulação com 5 clientes fictícios ({mode === 'fixed' ? 'limites fixos' : 'percentis entre os 5'})</caption>
        <thead><tr><th className="py-1 text-left font-medium text-muted">Cliente</th><th className="py-1 text-left font-medium text-muted">Dias sem comprar</th><th className="py-1 text-left font-medium text-muted">Pedidos</th><th className="py-1 text-left font-medium text-muted">Valor</th><th className="py-1 text-left font-medium text-muted">R · F · M</th></tr></thead>
        <tbody>
          {EXAMPLE.map((e) => { const s = scores.find((x) => x.id === e.id)!; return <tr key={e.id} className="border-t border-border"><td className="py-1">{e.id}</td><td>{e.r}</td><td>{e.f}</td><td>{(e.m / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td><td className="tabular-nums">{s.r_score} · {s.f_score} · {s.m_score}</td></tr>; })}
        </tbody>
      </table>
      <p className="mt-1 text-xs text-muted">Segmentos possíveis: {Object.values(SEGMENT_LABELS).join(', ')}.</p>
    </div>
  );
}

export function SettingsForm({ initial }: { initial: Input }) {
  const { form, state, pending, submit } = useActionForm({
    schema: settingsSchema, defaultValues: initial,
    action: (v: Input) => saveSettings(toCents(v)),
  });
  const w = form.watch(['rfm_mode', 'limits_r', 'limits_f', 'limits_m']);
  return (
    <FormShell onSubmit={submit} pending={pending} state={state} submitLabel="Salvar configurações">
      <Card title="Geral">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField form={form} name="timezone" label="Fuso horário (IANA)" hint="Ex.: America/Sao_Paulo. Define o «dia» das compras e dos relatórios." />
          <TextField form={form} name="observation_days" label="Janela de observação padrão (dias)" inputMode="numeric" hint="Reativação e recompra de campanha contam até X dias depois." />
        </div>
      </Card>

      <Card title="RFM" description="Como as notas de 1 a 5 são calculadas. Alterar vale para a próxima rodada; as anteriores ficam preservadas.">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField form={form} name="rfm_window_days" label="Janela de análise (dias)" inputMode="numeric" hint="De 30 a 1095. Só compras dentro dela entram em F e M." />
          <SelectField form={form} name="rfm_mode" label="Método" options={[{ value: 'percentile', label: 'Percentis (relativo à sua base)' }, { value: 'fixed', label: 'Limites fixos (você define)' }]} />
          <TextField form={form} name="new_customer_days" label="Cliente novo: dias desde a 1ª compra" inputMode="numeric" />
        </div>
        {w[0] === 'fixed' ? (
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <TextField form={form} name="limits_r" label="Recência (dias): 4 limites" hint="Crescentes. Ex.: 30, 60, 90, 180 → até 30 dias = nota 5." />
            <TextField form={form} name="limits_f" label="Frequência (pedidos): 4 limites" hint="Crescentes. Ex.: 2, 3, 5, 8." />
            <TextField form={form} name="limits_m" label="Valor (R$): 4 limites" hint="Crescentes, em reais. Ex.: 100, 300, 1000, 3000." />
          </div>
        ) : (
          <div className="hidden"><TextField form={form} name="limits_r" label="r" /><TextField form={form} name="limits_f" label="f" /><TextField form={form} name="limits_m" label="m" /></div>
        )}
        <div className="mt-4"><Simulator mode={w[0]} r={w[1]} f={w[2]} m={w[3]} /></div>
      </Card>

      <Card title="Regras de risco" description="Quatro motivos para um cliente aparecer em Reativação. Desligue os que não fazem sentido para o seu negócio.">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField form={form} name="risk_days" label="Em risco após (dias sem comprar)" inputMode="numeric" />
          <TextField form={form} name="inactive_days" label="Inativo após (dias sem comprar)" inputMode="numeric" hint="Maior que os dias de risco." />
          <TextField form={form} name="cycle_factor" label="Ciclo vencido: fator sobre o intervalo mediano" inputMode="decimal" hint="Ex.: 1,5 = passou de 1,5× o intervalo habitual." />
          <TextField form={form} name="cycle_min_purchases" label="Ciclo: mínimo de compras" inputMode="numeric" hint="A partir de 3, para a mediana fazer sentido." />
          <TextField form={form} name="cycle_min_days" label="Ciclo: mínimo de dias sem comprar" inputMode="numeric" />
          <TextField form={form} name="drop_window_days" label="Queda de frequência: janela (dias)" inputMode="numeric" hint="Compara a janela recente com a anterior, do mesmo tamanho." />
          <TextField form={form} name="drop_pct" label="Queda mínima (%)" inputMode="numeric" />
          <TextField form={form} name="drop_min_prev" label="Pedidos mínimos na janela anterior" inputMode="numeric" />
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <CheckField form={form} name="rule_inactivity" label="Regra de inatividade" />
          <CheckField form={form} name="rule_cycle" label="Regra de ciclo de recompra vencido" />
          <CheckField form={form} name="rule_drop" label="Regra de queda de frequência" />
          <CheckField form={form} name="rule_segment_change" label="Regra de mudança de segmento (Campeões/Fiéis que caíram)" />
        </div>
      </Card>

      <Card title="Prioridade das oportunidades" description="Prioridade = média ponderada de valor histórico, frequência e atraso (0 a 100).">
        <div className="grid gap-4 sm:grid-cols-3">
          <TextField form={form} name="w_value" label="Peso do valor" inputMode="numeric" />
          <TextField form={form} name="w_frequency" label="Peso da frequência" inputMode="numeric" />
          <TextField form={form} name="w_overdue" label="Peso do atraso" inputMode="numeric" />
          <TextField form={form} name="priority_high" label="Prioridade alta a partir de" inputMode="numeric" />
          <TextField form={form} name="priority_medium" label="Prioridade média a partir de" inputMode="numeric" />
        </div>
        <div className="mt-4"><CheckField form={form} name="alert_overdue_tasks" label="Avisar (notificação interna) sobre tarefas vencidas" /></div>
      </Card>
      <Alert tone="info">Essas configurações não enviam nada a clientes. Elas só decidem quem aparece nas listas, com que prioridade e como os indicadores são calculados.</Alert>
    </FormShell>
  );
}
