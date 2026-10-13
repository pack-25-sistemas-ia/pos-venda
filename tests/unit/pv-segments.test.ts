import { describe, expect, it } from 'vitest';
import { defaultCondition, describeCriteria, SEGMENT_FIELDS, validateCriteria, type Criteria } from '@/lib/pv/segments';

describe('validateCriteria (espelho do banco)', () => {
  const ok: Criteria = { match: 'all', conditions: [{ field: 'days_since_last', op: 'gte', value: 90 }, { field: 'rfm_segment', op: 'in', value: ['em_risco', 'atencao'] }] };

  it('aceita critérios válidos', () => expect(validateCriteria(ok)).toEqual([]));

  it('recusa estrutura inválida, vazia e grande demais', () => {
    expect(validateCriteria(null)[0]).toBe('Critérios inválidos.');
    expect(validateCriteria({ match: 'xor', conditions: [] })[0]).toBe('Critérios inválidos.');
    expect(validateCriteria({ match: 'all', conditions: [] })).toEqual(['Adicione ao menos uma condição.']);
    expect(validateCriteria({ match: 'all', conditions: Array.from({ length: 11 }, () => ({ field: 'campaign_history', op: 'any' })) })).toContain('No máximo 10 condições.');
  });

  it('só aceita campos e operadores da lista fechada (nada de SQL livre)', () => {
    expect(validateCriteria({ match: 'all', conditions: [{ field: 'name; drop table customers', op: 'eq', value: 1 }] })[0]).toContain('campo desconhecido');
    expect(validateCriteria({ match: 'all', conditions: [{ field: 'days_since_last', op: 'like', value: 1 }] })[0]).toContain('operador inválido');
    expect(validateCriteria({ match: 'all', conditions: [{ field: 'category', op: 'has', value: "x'); drop table purchases;--" }] })).toEqual([]); // texto livre só entra como VALOR escapado pelo banco
  });

  it.each([
    [{ field: 'days_since_last', op: 'gt', value: '90' }, 'use um número'],
    [{ field: 'total_spent_cents', op: 'gt', value: 1e13 }, 'use um número'],
    [{ field: 'last_purchase_date', op: 'gt', value: '31/12/2026' }, 'AAAA-MM-DD'],
    [{ field: 'rfm_segment', op: 'in', value: [] }, 'segmentos RFM válidos'],
    [{ field: 'rfm_segment', op: 'in', value: ['vip'] }, 'segmentos RFM válidos'],
    [{ field: 'state', op: 'eq', value: 'dormant' }, 'estado inválido'],
    [{ field: 'state', op: 'in', value: ['active', 'x'] }, 'estado inválido'],
    [{ field: 'category', op: 'has', value: '' }, 'informe a categoria'],
    [{ field: 'assigned_to', op: 'eq', value: 'abc' }, 'responsável inválido'],
    [{ field: 'permission', op: 'allowed', value: 'sms' }, 'informe o canal'],
  ])('valor inválido %j', (cond, msg) => expect(validateCriteria({ match: 'any', conditions: [cond] })[0]).toContain(msg));

  it('aceita operadores sem valor', () => {
    expect(validateCriteria({ match: 'all', conditions: [{ field: 'assigned_to', op: 'is_null' }, { field: 'campaign_history', op: 'none' }] })).toEqual([]);
  });

  it('o valor inicial de cada campo é válido', () => {
    for (const f of SEGMENT_FIELDS) {
      const c = defaultCondition(f.field);
      if (f.kind === 'category' || f.kind === 'seller') continue; // exigem escolha do usuário
      expect(validateCriteria({ match: 'all', conditions: [c] }), f.field).toEqual([]);
    }
  });
});

describe('describeCriteria', () => {
  it('descreve em português com E/OU', () => {
    const text = describeCriteria({ match: 'all', conditions: [{ field: 'days_since_last', op: 'gte', value: 90 }, { field: 'rfm_segment', op: 'in', value: ['em_risco'] }, { field: 'total_spent_cents', op: 'gt', value: 150000 }] });
    expect(text).toBe('Dias desde a última compra maior ou igual a 90 E Segmento RFM é um de Em risco E Total gasto (R$) maior que R$ 1.500,00');
    expect(describeCriteria({ match: 'any', conditions: [{ field: 'state', op: 'eq', value: 'inactive' }, { field: 'category', op: 'not_has', value: 'Bebidas' }] })).toBe('Situação do cliente é Inativo OU nunca comprou «Bebidas»');
    expect(describeCriteria({ match: 'all', conditions: [{ field: 'last_purchase_date', op: 'lt', value: '2026-03-05' }] })).toBe('Data da última compra antes de 05/03/2026');
    expect(describeCriteria({ match: 'all', conditions: [{ field: 'assigned_to', op: 'eq', value: '11111111-1111-4111-8111-111111111111' }] }, new Map([['11111111-1111-4111-8111-111111111111', 'Ana']]))).toBe('Responsável é Ana');
    expect(describeCriteria({ match: 'all', conditions: [] })).toBe('Sem condições');
  });
});
