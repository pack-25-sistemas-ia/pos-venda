#!/usr/bin/env node
// Gera supabase/tests/60_pv_rfm_fixtures.sql a partir de tests/fixtures/rfm-cases.json (valores calculados à mão).
// As MESMAS fixtures alimentam o espelho TypeScript (tests/unit). Um teste unitário garante que o SQL gerado está em dia.
// Uso: node scripts/gen-fixtures-sql.mjs [--check]
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cases = JSON.parse(readFileSync(join(root, 'tests', 'fixtures', 'rfm-cases.json'), 'utf8'));
const out = join(root, 'supabase', 'tests', '60_pv_rfm_fixtures.sql');
const j = (v) => `$j$${JSON.stringify(v)}$j$::jsonb`;
const q = (s) => `$m$${s}$m$`;

export function render() {
  const lines = [
    '-- GERADO por scripts/gen-fixtures-sql.mjs a partir de tests/fixtures/rfm-cases.json. NÃO edite à mão.',
    '-- Motor RFM puro (pv_rfm_scores / pv_rfm_classify): esperado calculado à mão; o TypeScript usa as mesmas fixtures.',
    '', 'do $$', 'begin',
  ];
  for (const c of cases.scores) lines.push(`  assert public.pv_rfm_scores(${j(c.rows)}, '${c.mode}', ${j(cases.limits)}) = ${j(c.expected)}, ${q('notas: ' + c.name)};`);
  for (const c of cases.invalid) lines.push(`  assert test.throws($q$select public.pv_rfm_scores(${j(c.rows)}, '${c.mode}', ${j(cases.limits)})$q$), ${q('deve recusar: ' + c.name)};`);
  for (const c of cases.classify) lines.push(`  assert public.pv_rfm_classify(${c.r}, ${c.f}, ${c.m}, ${c.frequency}, ${c.first_days}, ${c.new_days}) = '${c.expected}', ${q('segmento: ' + c.name)};`);
  lines.push(`  raise notice 'PASS: motor RFM — ${cases.scores.length} conjuntos de notas, ${cases.invalid.length} inválidos e ${cases.classify.length} classificações';`, 'end $$;', '');
  return lines.join('\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const text = render();
  if (process.argv.includes('--check')) {
    const cur = (() => { try { return readFileSync(out, 'utf8'); } catch { return ''; } })();
    if (cur !== text) { console.error('60_pv_rfm_fixtures.sql desatualizado: rode node scripts/gen-fixtures-sql.mjs'); process.exit(1); }
    console.log('fixtures SQL em dia');
  } else { writeFileSync(out, text); console.log('gerado', out); }
}
