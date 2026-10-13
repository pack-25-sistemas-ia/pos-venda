// Mensagens de reativação: modelos com variáveis {{variavel}} ou {{variavel|valor padrão}}.
// O sistema NÃO envia nada: a mensagem renderizada serve ao contato manual (copiar e usar no canal da empresa).
// Saída é sempre TEXTO (nunca HTML); variável desconhecida não é aceita; variável sem valor usa o padrão (ou fica vazia e é avisada).

export const TEMPLATE_VARIABLES = [
  { key: 'nome', label: 'Nome do cliente' },
  { key: 'primeiro_nome', label: 'Primeiro nome' },
  { key: 'empresa', label: 'Empresa do cliente' },
  { key: 'ultima_compra', label: 'Data da última compra' },
  { key: 'dias_sem_comprar', label: 'Dias desde a última compra' },
  { key: 'produto', label: 'Produto da última compra' },
  { key: 'vendedor', label: 'Nome do responsável' },
] as const;
export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number]['key'];
const KNOWN = new Set<string>(TEMPLATE_VARIABLES.map((v) => v.key));

export const MAX_TEMPLATE_LENGTH = 4000;
const TOKEN = /\{\{\s*([a-z_]+)\s*(?:\|([^{}]{0,80}))?\}\}/g;

export type TemplateVars = Partial<Record<TemplateVariable, string | null | undefined>>;
export type RenderResult = { text: string; missing: TemplateVariable[] };

/** Variáveis usadas no texto, na ordem, sem repetir. */
export function extractVariables(body: string): string[] {
  const out: string[] = [];
  for (const m of body.matchAll(TOKEN)) if (m[1] && !out.includes(m[1])) out.push(m[1]);
  return out;
}

/** Erros de um modelo: variáveis desconhecidas, chaves soltas ou tamanho. Lista vazia = válido. */
export function validateTemplate(body: string): string[] {
  const errors: string[] = [];
  if (body.length > MAX_TEMPLATE_LENGTH) errors.push(`O texto passa de ${MAX_TEMPLATE_LENGTH} caracteres.`);
  const unknown = extractVariables(body).filter((v) => !KNOWN.has(v));
  if (unknown.length) errors.push(`Variável desconhecida: ${unknown.map((u) => `{{${u}}}`).join(', ')}.`);
  const stripped = body.replace(TOKEN, '');
  if (/\{\{|\}\}/.test(stripped)) errors.push('Há chaves «{{ }}» mal formadas.');
  return errors;
}

/** Primeiro nome: primeira palavra do nome, com a inicial maiúscula. */
export function firstName(name: string | null | undefined): string {
  const w = (name ?? '').trim().split(/\s+/)[0] ?? '';
  return w ? w.charAt(0).toLocaleUpperCase('pt-BR') + w.slice(1).toLocaleLowerCase('pt-BR') : '';
}

/** Preenche o modelo. `missing` lista variáveis sem valor e sem padrão (ficam vazias; a tela avisa antes do uso). */
export function renderTemplate(body: string, vars: TemplateVars): RenderResult {
  const missing: TemplateVariable[] = [];
  const text = body.replace(TOKEN, (_all, key: string, fallback: string | undefined) => {
    if (!KNOWN.has(key)) return '';
    const value = (vars[key as TemplateVariable] ?? '').toString().trim();
    if (value) return value;
    const fb = (fallback ?? '').trim();
    if (fb) return fb;
    if (!missing.includes(key as TemplateVariable)) missing.push(key as TemplateVariable);
    return '';
  });
  // sem variável preenchida podem sobrar espaços duplos ou vírgula solta: arruma
  return { text: text.replace(/[ \t]{2,}/g, ' ').replace(/ ([,.!?])/g, '$1').replace(/^\s+|\s+$/g, ''), missing };
}
