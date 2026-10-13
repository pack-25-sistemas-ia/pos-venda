// CSV: exportação segura (neutraliza injeção de fórmula) e leitura de arquivos de importação com limites.
import Papa from 'papaparse';

export const MAX_IMPORT_BYTES = 2_000_000; // 2 MB
export const MAX_IMPORT_ROWS = 2000;
export const MAX_IMPORT_COLUMNS = 60;

const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * Valores iniciados por = + - @ TAB CR são executados como fórmula no Excel/Sheets ("CSV injection").
 * Prefixa com apóstrofo para virar texto comum. Sempre entre aspas.
 */
export function csvText(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '';
  const safe = FORMULA_START.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function csvDecimal(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '';
  return value.toFixed(decimals).replace('.', ',');
}

/** `int(n)` = contagem; `money(c)` = centavos exibidos em reais; número simples = decimal (2 casas, vírgula). */
export type CsvCell = string | number | null | undefined | { int: number } | { cents: number | null };
export const int = (n: number): CsvCell => ({ int: n });
export const money = (cents: number | null | undefined): CsvCell => ({ cents: cents ?? null });

function cell(c: CsvCell): string {
  if (c !== null && typeof c === 'object') {
    if ('int' in c) return String(c.int);
    return c.cents === null ? '' : csvDecimal(c.cents / 100);
  }
  if (typeof c === 'number') return csvDecimal(c);
  return csvText(c);
}

/** `;` como separador e vírgula decimal (padrão do Excel em português), UTF-8 com BOM, quebra CRLF. */
export function toCsv(headers: string[], rows: CsvCell[][]): string {
  const lines = [headers.map((h) => csvText(h)).join(';')];
  for (const row of rows) lines.push(row.map(cell).join(';'));
  return `﻿${lines.join('\r\n')}\r\n`;
}

// ---------------------------------------------------------------- leitura (importação)
export type ParsedTable =
  | { ok: true; headers: string[]; rows: string[][]; delimiter: string }
  | { ok: false; error: string };

/** Lê o CSV com limites de tamanho, linhas e colunas. Detecta `;`, `,` ou TAB. Cabeçalhos repetidos ganham sufixo. */
export function parseTable(text: string): ParsedTable {
  if (text.length > MAX_IMPORT_BYTES) return { ok: false, error: 'Arquivo muito grande (máximo de 2 MB).' };
  const clean = text.replace(/^﻿/, '');
  const result = Papa.parse<string[]>(clean, { skipEmptyLines: 'greedy', delimitersToGuess: [';', ',', '\t'] });
  const data = result.data;
  if (data.length < 2) return { ok: false, error: 'O arquivo precisa ter a linha de cabeçalho e ao menos uma linha de dados.' };
  if (data.length - 1 > MAX_IMPORT_ROWS) return { ok: false, error: `Muitas linhas (máximo de ${MAX_IMPORT_ROWS} por importação). Divida o arquivo.` };
  const head = (data[0] ?? []).map((h) => h.trim());
  if (head.length > MAX_IMPORT_COLUMNS) return { ok: false, error: `Colunas demais (máximo de ${MAX_IMPORT_COLUMNS}).` };
  if (head.every((h) => h === '')) return { ok: false, error: 'A primeira linha precisa conter os nomes das colunas.' };
  const seen = new Map<string, number>();
  const headers = head.map((h, i) => {
    const base = h || `coluna ${i + 1}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base} (${n})`;
  });
  const rows = data.slice(1).map((cells) => headers.map((_, i) => (cells[i] ?? '').trim().slice(0, 500)));
  return { ok: true, headers, rows, delimiter: result.meta.delimiter };
}
