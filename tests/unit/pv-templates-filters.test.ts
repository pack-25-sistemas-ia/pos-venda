import { describe, expect, it } from 'vitest';
import { csvText, money, toCsv } from '@/lib/pv/csv';
import { filtersToQuery, parseFilters } from '@/lib/pv/filters';
import { bucketLabel, formatBRL, formatDocument, formatPct, formatPhone, priorityLabel, variationPct } from '@/lib/pv/format';
import { extractVariables, firstName, renderTemplate, validateTemplate } from '@/lib/pv/templates';

describe('modelo de mensagem', () => {
  it('substitui variáveis e usa o padrão quando falta o valor', () => {
    const r = renderTemplate('Olá, {{primeiro_nome|cliente}}! Faz {{dias_sem_comprar}} dias da sua última compra.', { primeiro_nome: 'Ana', dias_sem_comprar: '95' });
    expect(r).toEqual({ text: 'Olá, Ana! Faz 95 dias da sua última compra.', missing: [] });
    expect(renderTemplate('Olá, {{primeiro_nome|cliente}}!', { primeiro_nome: '  ' }).text).toBe('Olá, cliente!');
    expect(renderTemplate('Olá, {{ primeiro_nome | tudo bem }}!', {}).text).toBe('Olá, tudo bem!');
  });
  it('sem valor e sem padrão: vazio e avisado, sem sobrar espaço duplo', () => {
    const r = renderTemplate('Oi {{empresa}} , tudo bem?', {});
    expect(r.missing).toEqual(['empresa']);
    expect(r.text).toBe('Oi, tudo bem?');
  });
  it('é só texto: HTML do valor não é interpretado nem acrescentado', () => {
    const r = renderTemplate('Oi {{nome}}', { nome: '<script>alert(1)</script>' });
    expect(r.text).toBe('Oi <script>alert(1)</script>'); // a tela escapa na exibição; aqui não há HTML próprio
    expect(r.text).not.toContain('&lt;');
  });
  it('valida variáveis desconhecidas, chaves soltas e tamanho', () => {
    expect(validateTemplate('Oi {{nome}} {{ultima_compra}}')).toEqual([]);
    expect(validateTemplate('Oi {{cpf}}')[0]).toContain('{{cpf}}');
    expect(validateTemplate('Oi {{nome')[0]).toContain('mal formadas');
    expect(validateTemplate('x'.repeat(4001))[0]).toContain('4000');
    expect(extractVariables('{{nome}} {{nome}} {{empresa|x}}')).toEqual(['nome', 'empresa']);
  });
  it('variável desconhecida no render vira vazia (nunca vaza texto)', () => {
    expect(renderTemplate('A{{cpf}}B', {}).text).toBe('AB');
  });
  it('primeiro nome', () => {
    expect(firstName('  maria DA silva ')).toBe('Maria');
    expect(firstName(null)).toBe('');
  });
});

describe('filtros', () => {
  const today = '2026-10-12';
  it('padrão: 90 dias terminando hoje', () => {
    expect(parseFilters({}, today)).toMatchObject({ period: '90d', from: '2026-07-15', to: today, seller: null, segment: null, category: null, status: null });
  });
  it('períodos fixos', () => {
    expect(parseFilters({ period: '30d' }, today).from).toBe('2026-09-13');
    expect(parseFilters({ period: '365d' }, today).from).toBe('2025-10-13');
  });
  it('personalizado válido e inválido', () => {
    expect(parseFilters({ period: 'custom', from: '2026-01-01', to: '2026-02-01' }, today)).toMatchObject({ period: 'custom', from: '2026-01-01', to: '2026-02-01' });
    expect(parseFilters({ period: 'custom', from: '2026-02-01', to: '2026-01-01' }, today).period).toBe('90d');
    expect(parseFilters({ period: 'custom', from: '2026-02-30', to: '2026-03-01' }, today).period).toBe('90d');
    expect(parseFilters({ period: 'custom', from: '2020-01-01', to: '2026-01-01' }, today).period).toBe('90d');
  });
  it('descarta valores inválidos sem erro', () => {
    const f = parseFilters({ seller: 'não-uuid', segment: 'x', status: 'y', category: '<b>' }, today);
    expect(f).toMatchObject({ seller: null, segment: null, status: null, category: null });
  });
  it('aceita filtros válidos e serializa para a URL', () => {
    const f = parseFilters({ period: '30d', seller: '11111111-1111-4111-8111-111111111111', segment: 'em_risco', status: 'at_risk', category: 'Bebidas' }, today);
    expect(f).toMatchObject({ segment: 'em_risco', status: 'at_risk', category: 'Bebidas' });
    expect(filtersToQuery(f)).toBe('period=30d&seller=11111111-1111-4111-8111-111111111111&segment=em_risco&category=Bebidas&status=at_risk');
  });
});

describe('formatação', () => {
  it('moeda, percentual e vazio', () => {
    expect(formatBRL(123456).replace(/\s/g, ' ')).toBe('R$ 1.234,56');
    expect(formatBRL(null)).toBe('—');
    expect(formatPct(33.333)).toBe('33,3%');
    expect(formatPct(null)).toBe('—');
    expect(formatPct(0)).toBe('0,0%');
  });
  it('telefone, documento e prioridade', () => {
    expect(formatPhone('5511912345678')).toBe('+55 (11) 91234-5678');
    expect(formatDocument('12345678909')).toBe('123.456.789-09');
    expect(formatDocument('11222333000181')).toBe('11.222.333/0001-81');
    expect(priorityLabel(70)).toBe('Alta');
    expect(priorityLabel(69)).toBe('Média');
    expect(priorityLabel(39)).toBe('Baixa');
  });
  it('rótulos de série e variação', () => {
    expect(bucketLabel('2026-09-30', 'day')).toBe('30/09');
    expect(bucketLabel('2026-09-01', 'month')).toBe('set/26');
    expect(variationPct(150, 100)).toBe(50);
    expect(variationPct(10, 0)).toBeNull();
  });
});

describe('CSV de exportação', () => {
  it('neutraliza fórmulas e formata dinheiro em reais', () => {
    expect(csvText('=SOMA(A1)')).toBe('"\'=SOMA(A1)"');
    expect(csvText('@x')).toBe('"\'@x"');
    expect(csvText('a"b')).toBe('"a""b"');
    const out = toCsv(['Cliente', 'Receita'], [['Ana', money(123456)], ['Bia', money(null)]]);
    expect(out).toBe('﻿"Cliente";"Receita"\r\n"Ana";1234,56\r\n"Bia";\r\n');
  });
});
