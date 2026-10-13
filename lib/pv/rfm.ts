// Espelho TypeScript do motor RFM puro (pv_rfm_scores / pv_rfm_classify / pv_score_fixed). A fonte da verdade é o BANCO;
// este espelho serve ao simulador de parâmetros e passa nas mesmas fixtures calculadas à mão (tests/fixtures/rfm-cases.json).
// Metodologia: docs/RFM_MODEL.md.

export type RfmRow = { id: string; r: number; f: number; m: number };
export type RfmScore = { id: string; r_score: number; f_score: number; m_score: number };
export type RfmLimits = { r: [number, number, number, number]; f: [number, number, number, number]; m: [number, number, number, number] };
export type RfmMode = 'percentile' | 'fixed';

export const SEGMENTS = ['campeoes', 'fieis', 'novos', 'promissores', 'em_risco', 'atencao', 'inativos', 'sem_compras'] as const;
export type SegmentKey = (typeof SEGMENTS)[number];
export const SEGMENT_LABELS: Record<SegmentKey, string> = {
  campeoes: 'Campeões', fieis: 'Fiéis', novos: 'Novos clientes', promissores: 'Promissores', em_risco: 'Em risco', atencao: 'Precisam de atenção', inativos: 'Inativos', sem_compras: 'Sem compras',
};
export const SEGMENT_HINTS: Record<SegmentKey, string> = {
  campeoes: 'Compraram há pouco, com frequência e valor altos.', fieis: 'Compram com regularidade.', novos: 'Primeira compra recente.', promissores: 'Compraram recentemente, mas pouco ainda.',
  em_risco: 'Já foram bons clientes e estão distantes.', atencao: 'Comportamento intermediário ou de baixo valor.', inativos: 'Sem compra na janela de análise.', sem_compras: 'Nunca compraram.',
};
export const DEFAULT_LIMITS: RfmLimits = { r: [30, 60, 90, 180], f: [2, 3, 5, 8], m: [10000, 30000, 100000, 300000] };

/** Nota 1–5 por limites fixos. Recência: menor é melhor; F e M: maior é melhor. */
export function scoreFixed(v: number, lim: readonly number[], higherBetter: boolean): number {
  const [a, b, c, d] = lim as [number, number, number, number];
  if (higherBetter) return v >= d ? 5 : v >= c ? 4 : v >= b ? 3 : v >= a ? 2 : 1;
  return v <= a ? 5 : v <= b ? 4 : v <= c ? 3 : v <= d ? 2 : 1;
}

/** percent_rank do PostgreSQL: (posição − 1) ÷ (n − 1); empates recebem a menor posição; n = 1 → 0. */
export function percentRank(values: number[], v: number): number {
  const n = values.length;
  if (n <= 1) return 0;
  const below = values.filter((x) => x < v).length;
  return below / (n - 1);
}

export function rfmScores(rows: RfmRow[], mode: RfmMode, limits: RfmLimits = DEFAULT_LIMITS): RfmScore[] {
  if (!Array.isArray(rows)) throw new Error('linhas inválidas');
  if (mode !== 'percentile' && mode !== 'fixed') throw new Error('modo inválido');
  const sorted = [...rows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (mode === 'fixed') {
    return sorted.map((x) => ({ id: x.id, r_score: scoreFixed(x.r, limits.r, false), f_score: scoreFixed(x.f, limits.f, true), m_score: scoreFixed(x.m, limits.m, true) }));
  }
  // aritmética inteira (sem ponto flutuante): below = quantos têm valor MENOR (rank − 1, empates na mesma posição)
  const n = rows.length;
  const below = (vals: number[], v: number) => vals.filter((x) => x < v).length;
  const rs = rows.map((x) => x.r);
  const fs = rows.map((x) => x.f);
  const ms = rows.map((x) => x.m);
  return sorted.map((x) => ({
    id: x.id,
    r_score: n <= 1 ? 5 : Math.min(5, 1 + Math.floor((5 * (n - 1 - below(rs, x.r))) / (n - 1))),
    f_score: n <= 1 ? 1 : Math.min(5, 1 + Math.floor((5 * below(fs, x.f)) / (n - 1))),
    m_score: n <= 1 ? 1 : Math.min(5, 1 + Math.floor((5 * below(ms, x.m)) / (n - 1))),
  }));
}

/** Segmento pela regra documentada (primeira que servir). */
export function rfmClassify(r: number, f: number, m: number, frequency: number, firstDays: number, newDays: number): SegmentKey {
  if (r >= 4 && f >= 4 && m >= 4) return 'campeoes';
  if (r >= 3 && f >= 3) return 'fieis';
  if (frequency === 1 && firstDays <= newDays) return 'novos';
  if (r >= 4) return 'promissores';
  if (r <= 2 && (f >= 3 || m >= 3)) return 'em_risco';
  return 'atencao';
}

/** Pequena amostra: com menos de 5 clientes pontuados as notas são só indicativas. */
export const isLowSample = (scored: number) => scored < 5;
