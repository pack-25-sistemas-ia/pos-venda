import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error módulo .mjs sem tipos
import { render } from '@/scripts/gen-fixtures-sql.mjs';
import { isLowSample, percentRank, rfmClassify, rfmScores, scoreFixed, type RfmLimits, type RfmMode, type RfmRow } from '@/lib/pv/rfm';

const cases = JSON.parse(readFileSync(join(process.cwd(), 'tests', 'fixtures', 'rfm-cases.json'), 'utf8')) as {
  limits: RfmLimits;
  scores: Array<{ name: string; mode: RfmMode; rows: RfmRow[]; expected: unknown }>;
  invalid: Array<{ name: string; mode: string; rows: unknown }>;
  classify: Array<{ name: string; r: number; f: number; m: number; frequency: number; first_days: number; new_days: number; expected: string }>;
};

// As MESMAS fixtures (calculadas à mão) passam no banco (supabase/tests/60_pv_rfm_fixtures.sql) e aqui.
describe('RFM (espelho do banco) — fixtures compartilhadas', () => {
  for (const c of cases.scores) it(`notas: ${c.name}`, () => expect(rfmScores(c.rows, c.mode, cases.limits)).toEqual(c.expected));
  for (const c of cases.invalid) it(`recusa: ${c.name}`, () => expect(() => rfmScores(c.rows as RfmRow[], c.mode as RfmMode, cases.limits)).toThrow());
  for (const c of cases.classify) it(`segmento: ${c.name}`, () => expect(rfmClassify(c.r, c.f, c.m, c.frequency, c.first_days, c.new_days)).toBe(c.expected));
});

describe('propriedades do motor', () => {
  it('é determinístico e não depende da ordem das linhas', () => {
    const rows: RfmRow[] = Array.from({ length: 40 }, (_, i) => ({ id: `c${String(i).padStart(2, '0')}`, r: (i * 37) % 200, f: 1 + ((i * 11) % 9), m: 1000 + ((i * 7919) % 90000) }));
    const a = rfmScores(rows, 'percentile');
    const b = rfmScores([...rows].reverse(), 'percentile');
    expect(a).toEqual(b);
  });
  it('notas sempre de 1 a 5 e monotônicas (maior frequência nunca tem nota menor)', () => {
    const rows: RfmRow[] = Array.from({ length: 60 }, (_, i) => ({ id: `c${String(i).padStart(2, '0')}`, r: (i * 13) % 300, f: 1 + ((i * 5) % 17), m: 500 + ((i * 3571) % 200000) }));
    const out = rfmScores(rows, 'percentile');
    for (const s of out) for (const v of [s.r_score, s.f_score, s.m_score]) { expect(v).toBeGreaterThanOrEqual(1); expect(v).toBeLessThanOrEqual(5); }
    const byF = new Map(rows.map((r) => [r.id, r.f]));
    for (const x of out) for (const y of out) if ((byF.get(x.id) ?? 0) > (byF.get(y.id) ?? 0)) expect(x.f_score).toBeGreaterThanOrEqual(y.f_score);
  });
  it('percent_rank como o PostgreSQL', () => {
    expect(percentRank([1, 2, 3, 4, 5], 3)).toBe(0.5);
    expect(percentRank([1, 1, 3], 1)).toBe(0);
    expect(percentRank([9], 9)).toBe(0);
  });
  it('limites fixos nas bordas', () => {
    expect(scoreFixed(30, [30, 60, 90, 180], false)).toBe(5);
    expect(scoreFixed(31, [30, 60, 90, 180], false)).toBe(4);
    expect(scoreFixed(8, [2, 3, 5, 8], true)).toBe(5);
    expect(scoreFixed(1, [2, 3, 5, 8], true)).toBe(1);
  });
  it('pequena amostra', () => {
    expect(isLowSample(4)).toBe(true);
    expect(isLowSample(5)).toBe(false);
  });
  it('o SQL gerado das fixtures está em dia', () => {
    expect(readFileSync(join(process.cwd(), 'supabase', 'tests', '60_pv_rfm_fixtures.sql'), 'utf8')).toBe(render());
  });
});
