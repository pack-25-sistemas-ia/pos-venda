import { describe, expect, it } from 'vitest';
import { parseTable } from '@/lib/pv/csv';
import { buildRows, CUSTOMER_FIELDS, mappingProblems, parseDateFlexible, parseMoneyToCents, parseStatus, PURCHASE_FIELDS, suggestMapping } from '@/lib/pv/import';

describe('parseMoneyToCents', () => {
  it.each([
    ['R$ 1.234,56', '123456'],
    ['1234,5', '123450'],
    ['1234.56', '123456'],
    ['1.234', '123400'],
    ['0,99', '99'],
    ['0', '0'],
    ['25', '2500'],
    ['1.000.000,00', '100000000'],
    ['  89,90 ', '8990'],
  ])('%s -> %s', (raw, cents) => expect(parseMoneyToCents(raw)).toBe(cents));

  it.each(['', 'abc', '-10', '1,234,56', '12,345', '1..234', '1.23.4', '12,3,4', 'R$', '9999999999999,99', '1.2345'])('rejeita %j', (raw) => expect(parseMoneyToCents(raw)).toBeNull());
});

describe('parseDateFlexible', () => {
  it.each([
    ['31/12/2026', '2026-12-31'],
    ['1/2/2026', '2026-02-01'],
    ['31-12-2026', '2026-12-31'],
    ['2026-12-31', '2026-12-31'],
    ['2026-12-31T14:30:00', '2026-12-31'],
    ['31/12/2026 14:30', '2026-12-31'],
    ['29/02/2028', '2028-02-29'],
  ])('%s -> %s', (raw, iso) => expect(parseDateFlexible(raw)).toBe(iso));

  it.each(['', '31/02/2026', '29/02/2027', '2026-13-01', '00/00/0000', 'ontem', '12/2026'])('rejeita %j', (raw) => expect(parseDateFlexible(raw)).toBeNull());
});

describe('parseStatus', () => {
  it('normaliza sinônimos, vazio e desconhecido', () => {
    expect(parseStatus('Concluída')).toBe('completed');
    expect(parseStatus('PAGO')).toBe('completed');
    expect(parseStatus('Cancelada')).toBe('cancelled');
    expect(parseStatus('')).toBe('');
    expect(parseStatus('Em análise')).toBe('Em análise');
  });
});

describe('parseTable', () => {
  it('detecta ; e remove BOM', () => {
    const t = parseTable('﻿Nome;E-mail\r\nAna;ana@x.com\r\nBia;bia@x.com\r\n');
    expect(t).toMatchObject({ ok: true, headers: ['Nome', 'E-mail'], delimiter: ';' });
    if (t.ok) expect(t.rows).toEqual([['Ana', 'ana@x.com'], ['Bia', 'bia@x.com']]);
  });
  it('detecta vírgula e renomeia cabeçalhos repetidos', () => {
    const t = parseTable('a,a,b\n1,2,3\n');
    if (!t.ok) throw new Error('esperava ok');
    expect(t.headers).toEqual(['a', 'a (2)', 'b']);
    expect(t.delimiter).toBe(',');
  });
  it('recusa arquivo sem dados, grande demais ou com linhas demais', () => {
    expect(parseTable('so cabecalho\n')).toMatchObject({ ok: false });
    expect(parseTable('a\n' + 'x'.repeat(2_100_000))).toMatchObject({ ok: false, error: expect.stringContaining('grande') });
    expect(parseTable('a\n' + Array.from({ length: 2001 }, (_, i) => String(i)).join('\n'))).toMatchObject({ ok: false, error: expect.stringContaining('Muitas linhas') });
    expect(parseTable('a\n' + Array.from({ length: 2000 }, (_, i) => String(i)).join('\n'))).toMatchObject({ ok: true });
  });
  it('aceita campos com aspas e quebra de linha', () => {
    const t = parseTable('nome;obs\n"Ana ""A""";"linha1\nlinha2"\n');
    if (!t.ok) throw new Error('esperava ok');
    expect(t.rows[0]).toEqual(['Ana "A"', 'linha1\nlinha2']);
  });
});

describe('suggestMapping / mappingProblems / buildRows', () => {
  const headers = ['Pedido', 'Data da Compra', 'E-mail', 'Valor Total', 'Situação', 'Categoria', 'Observação extra'];

  it('sugere por cabeçalho sem acento e sem repetir coluna', () => {
    const m = suggestMapping(headers, PURCHASE_FIELDS);
    expect(m).toMatchObject({ order_id: 0, date: 1, customer_email: 2, total: 3, status: 4, category: 5, product: null, customer_document: null });
    const used = Object.values(m).filter((v) => v !== null);
    expect(new Set(used).size).toBe(used.length);
  });

  it('reconhece cabeçalhos escritos de forma natural, em português', () => {
    const m = suggestMapping(['Número do pedido', 'Data da Venda', 'E-mail do cliente', 'CPF do cliente', 'Valor do pedido', 'Status do pedido', 'Nome do produto', 'Categoria do produto'], PURCHASE_FIELDS);
    expect(m).toMatchObject({ date: 1, customer_email: 2, customer_document: 3, total: 4, status: 5, product: 6, category: 7, customer_name: null });
    const c = suggestMapping(['Nome do cliente', 'E-mail do cliente', 'Código do cliente'], CUSTOMER_FIELDS);
    expect(c).toMatchObject({ name: 0, email: 1, external_id: 2 });
  });

  it('exige campos obrigatórios e identificação do cliente', () => {
    expect(mappingProblems({ date: 1, customer_email: 2, total: 3 }, PURCHASE_FIELDS, 'purchases')).toEqual([]);
    expect(mappingProblems({ date: null, customer_email: 2, total: 3 }, PURCHASE_FIELDS, 'purchases')[0]).toContain('Data da compra');
    expect(mappingProblems({ date: 1, total: 3 }, PURCHASE_FIELDS, 'purchases').join(' ')).toContain('identifique o cliente');
    expect(mappingProblems({ date: 1, customer_email: 2 }, PURCHASE_FIELDS, 'purchases').join(' ')).toContain('Valor total');
    expect(mappingProblems({ name: null }, CUSTOMER_FIELDS, 'customers')[0]).toContain('Nome');
    expect(mappingProblems({ name: 0, email: 0 }, CUSTOMER_FIELDS, 'customers')[0]).toContain('mesma coluna');
  });

  it('converte formatos e avisa o que não converte', () => {
    const m = suggestMapping(headers, PURCHASE_FIELDS);
    const { rows, problems } = buildRows(
      [
        ['A-1', '31/01/2026', 'ana@x.com', 'R$ 1.234,56', 'Concluída', 'Bebidas', ''],
        ['A-2', '32/01/2026', 'bia@x.com', 'abc', 'Cancelada', '', ''],
        ['', '05/02/2026', 'cris@x.com', '', '', '', ''],
      ],
      m,
      PURCHASE_FIELDS,
    );
    expect(rows[0]).toEqual({ order_id: 'A-1', date: '2026-01-31', customer_email: 'ana@x.com', total_cents: '123456', status: 'completed', category: 'Bebidas' });
    expect(rows[1]).toEqual({ order_id: 'A-2', customer_email: 'bia@x.com', status: 'cancelled' });
    expect(rows[2]).toEqual({ date: '2026-02-05', customer_email: 'cris@x.com' });
    expect(problems).toEqual([expect.stringContaining('Linha 3: data «32/01/2026»'), expect.stringContaining('Linha 3: valor «abc»')]);
  });
});
