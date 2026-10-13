// Assistente de importação: sugestão de mapeamento de colunas e conversão de valores brasileiros (dinheiro, data, status).
// A validação de verdade (duplicidade, cliente existente, limites) é do BANCO; aqui só se converte o formato e se avisa o que não deu para converter.

export type FieldKind = 'text' | 'money' | 'date' | 'status' | 'number';
export type FieldDef = {
  /** Identificador na tela. */
  key: string;
  /** Chave esperada pela função SQL. */
  out: string;
  label: string;
  hint?: string;
  required?: boolean;
  kind: FieldKind;
  aliases: string[];
};

export function normalizeHeader(header: string): string {
  return header
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export const CUSTOMER_FIELDS: FieldDef[] = [
  { key: 'name', out: 'name', label: 'Nome', required: true, kind: 'text', aliases: ['nome', 'name', 'cliente', 'razao_social', 'nome_completo', 'nome_do_cliente', 'nome_cliente'] },
  { key: 'email', out: 'email', label: 'E-mail', kind: 'text', aliases: ['email', 'e_mail', 'mail', 'email_do_cliente', 'e_mail_do_cliente'] },
  { key: 'phone', out: 'phone', label: 'Telefone', hint: 'Com DDD.', kind: 'text', aliases: ['telefone', 'celular', 'fone', 'whatsapp', 'phone', 'tel', 'telefone_celular', 'celular_whatsapp'] },
  { key: 'document', out: 'document', label: 'CPF/CNPJ', kind: 'text', aliases: ['cpf', 'cnpj', 'cpf_cnpj', 'documento', 'document', 'cpf_ou_cnpj'] },
  { key: 'company_name', out: 'company_name', label: 'Empresa', kind: 'text', aliases: ['empresa', 'company', 'company_name'] },
  { key: 'external_id', out: 'external_id', label: 'Identificador no seu sistema', hint: 'Ajuda a evitar duplicidade.', kind: 'text', aliases: ['id', 'codigo', 'cod_cliente', 'id_cliente', 'external_id', 'customer_id', 'codigo_do_cliente', 'id_do_cliente'] },
  { key: 'type', out: 'type', label: 'Tipo (pessoa/empresa)', kind: 'text', aliases: ['tipo', 'tipo_pessoa', 'type'] },
  { key: 'notes', out: 'notes', label: 'Observações', kind: 'text', aliases: ['observacoes', 'observacao', 'obs', 'notes', 'notas'] },
];

export const PURCHASE_FIELDS: FieldDef[] = [
  { key: 'order_id', out: 'order_id', label: 'Número do pedido', hint: 'Evita importar o mesmo pedido duas vezes.', kind: 'text', aliases: ['pedido', 'numero_pedido', 'n_pedido', 'order', 'order_id', 'id_pedido', 'venda'] },
  { key: 'date', out: 'date', label: 'Data da compra', required: true, hint: 'DD/MM/AAAA ou AAAA-MM-DD. A hora é ignorada.', kind: 'date', aliases: ['data', 'data_compra', 'data_da_compra', 'data_pedido', 'date', 'emissao', 'data_do_pedido', 'data_da_venda', 'data_venda'] },
  { key: 'customer_email', out: 'customer_email', label: 'E-mail do cliente', kind: 'text', aliases: ['email', 'e_mail', 'email_cliente', 'customer_email', 'email_do_cliente', 'e_mail_do_cliente', 'e_mail_cliente'] },
  { key: 'customer_document', out: 'customer_document', label: 'CPF/CNPJ do cliente', kind: 'text', aliases: ['cpf', 'cnpj', 'cpf_cnpj', 'documento', 'documento_cliente', 'customer_document', 'cpf_do_cliente', 'cnpj_do_cliente', 'cpf_cnpj_do_cliente', 'documento_do_cliente'] },
  { key: 'customer_external_id', out: 'customer_external_id', label: 'Identificador do cliente', kind: 'text', aliases: ['id_cliente', 'cod_cliente', 'codigo_cliente', 'customer_id', 'customer_external_id', 'id_do_cliente', 'codigo_do_cliente'] },
  { key: 'customer_name', out: 'customer_name', label: 'Nome do cliente', hint: 'Só usado para cadastrar clientes ausentes.', kind: 'text', aliases: ['cliente', 'nome_cliente', 'nome', 'customer_name', 'nome_do_cliente'] },
  { key: 'total', out: 'total_cents', label: 'Valor total', hint: 'Em reais. Vazio: soma dos itens.', kind: 'money', aliases: ['valor', 'valor_total', 'total', 'total_pedido', 'amount', 'faturamento', 'valor_do_pedido', 'total_do_pedido', 'valor_total_do_pedido'] },
  { key: 'refunded', out: 'refunded_cents', label: 'Valor estornado', kind: 'money', aliases: ['estorno', 'valor_estornado', 'devolucao', 'devolvido', 'refund', 'refunded'] },
  { key: 'status', out: 'status', label: 'Status', hint: 'concluída ou cancelada (vazio = concluída).', kind: 'status', aliases: ['status', 'situacao', 'estado', 'status_do_pedido', 'situacao_do_pedido'] },
  { key: 'product', out: 'product', label: 'Produto', kind: 'text', aliases: ['produto', 'item', 'descricao', 'product', 'nome_produto', 'nome_do_produto', 'descricao_do_produto'] },
  { key: 'sku', out: 'sku', label: 'SKU/Código do produto', kind: 'text', aliases: ['sku', 'codigo_produto', 'cod_produto'] },
  { key: 'category', out: 'category', label: 'Categoria', kind: 'text', aliases: ['categoria', 'category', 'grupo', 'linha', 'categoria_do_produto'] },
  { key: 'quantity', out: 'quantity', label: 'Quantidade', kind: 'number', aliases: ['quantidade', 'qtd', 'qtde', 'quantity'] },
  { key: 'unit_price', out: 'unit_price_cents', label: 'Preço unitário', kind: 'money', aliases: ['preco', 'preco_unitario', 'valor_unitario', 'unit_price', 'price', 'valor_unit', 'preco_unit'] },
];

/** Mapeamento: chave do campo -> índice da coluna do arquivo (ou null). */
export type Mapping = Record<string, number | null>;

/** Sugere o mapeamento pelo nome do cabeçalho (sem acento/caixa). Cada coluna é usada por no máximo um campo. */
export function suggestMapping(headers: string[], fields: FieldDef[]): Mapping {
  const norm = headers.map(normalizeHeader);
  const used = new Set<number>();
  const mapping: Mapping = {};
  for (const f of fields) {
    let idx = -1;
    for (const alias of f.aliases) {
      const i = norm.findIndex((h, k) => h === alias && !used.has(k));
      if (i >= 0) { idx = i; break; }
    }
    mapping[f.key] = idx >= 0 ? idx : null;
    if (idx >= 0) used.add(idx);
  }
  return mapping;
}

/** Campos obrigatórios sem coluna escolhida, e a regra de identificação do cliente nas compras. */
export function mappingProblems(mapping: Mapping, fields: FieldDef[], kind: 'customers' | 'purchases'): string[] {
  const out: string[] = [];
  for (const f of fields) if (f.required && mapping[f.key] == null) out.push(`Escolha a coluna de «${f.label}».`);
  if (kind === 'purchases' && mapping.customer_email == null && mapping.customer_document == null && mapping.customer_external_id == null) {
    out.push('Escolha ao menos uma coluna que identifique o cliente (e-mail, CPF/CNPJ ou identificador).');
  }
  if (kind === 'purchases' && mapping.total == null && mapping.unit_price == null) out.push('Escolha a coluna de «Valor total» (ou de preço unitário e quantidade).');
  const picked = Object.values(mapping).filter((v): v is number => v != null);
  if (new Set(picked).size !== picked.length) out.push('A mesma coluna foi escolhida para dois campos.');
  return out;
}

/** "R$ 1.234,56" | "1234,5" | "1234.56" | "1.234" -> centavos (texto inteiro). Inválido/negativo -> null. */
export function parseMoneyToCents(raw: string): string | null {
  let s = raw.replace(/R\$/gi, '').replace(/\s/g, '');
  if (s === '') return null;
  if (!/^\d[\d.,]*$/.test(s)) return null;
  let reais: string;
  let frac = '';
  if (s.includes(',')) {
    const parts = s.split(',');
    if (parts.length !== 2) return null;
    const intPart = (parts[0] ?? '').replace(/\./g, '');
    if (!/^\d+$/.test(intPart) || !/^\d{1,2}$/.test(parts[1] ?? '')) return null;
    if ((parts[0] ?? '').includes('.') && !/^\d{1,3}(\.\d{3})+$/.test(parts[0] ?? '')) return null;
    reais = intPart;
    frac = parts[1] ?? '';
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    reais = s.replace(/\./g, '');
  } else if (/^\d+\.\d{1,2}$/.test(s)) {
    const [a, b] = s.split('.') as [string, string];
    reais = a;
    frac = b;
  } else if (/^\d+$/.test(s)) {
    reais = s;
  } else {
    return null;
  }
  s = `${reais}${frac.padEnd(2, '0')}`.replace(/^0+(?=\d)/, '');
  return s.length > 13 ? null : s;
}

/** "31/12/2026" | "31-12-2026" | "2026-12-31" (hora ignorada) -> "AAAA-MM-DD". Data impossível -> null. */
export function parseDateFlexible(raw: string): string | null {
  const s = raw.trim();
  let y: number, m: number, d: number;
  let r = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/.exec(s);
  if (r) { y = Number(r[1]); m = Number(r[2]); d = Number(r[3]); }
  else {
    r = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:[T\s].*)?$/.exec(s);
    if (!r) return null;
    d = Number(r[1]); m = Number(r[2]); y = Number(r[3]);
  }
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

const COMPLETED = new Set(['completed', 'concluida', 'concluido', 'pago', 'paga', 'aprovado', 'aprovada', 'entregue', 'faturado', 'faturada', 'finalizado', 'finalizada']);
const CANCELLED = new Set(['cancelled', 'canceled', 'cancelada', 'cancelado', 'devolvido', 'devolvida', 'recusado', 'recusada']);
/** Texto livre de status -> completed | cancelled. Vazio -> '' (o banco assume concluída). Desconhecido volta como veio (o banco recusa com mensagem). */
export function parseStatus(raw: string): string {
  const s = normalizeHeader(raw);
  if (s === '') return '';
  if (COMPLETED.has(s)) return 'completed';
  if (CANCELLED.has(s)) return 'cancelled';
  return raw.trim();
}

export type BuiltRows = { rows: Array<Record<string, string>>; problems: string[] };

/** Aplica o mapeamento e converte formatos. Valor que não converte vira vazio e gera um aviso por linha (o banco recusa a linha). */
export function buildRows(table: string[][], mapping: Mapping, fields: FieldDef[]): BuiltRows {
  const rows: Array<Record<string, string>> = [];
  const problems: string[] = [];
  table.forEach((cells, lineIdx) => {
    const line = lineIdx + 2;
    const rec: Record<string, string> = {};
    for (const f of fields) {
      const col = mapping[f.key];
      if (col == null) continue;
      const raw = (cells[col] ?? '').trim();
      if (raw === '') continue;
      if (f.kind === 'money') {
        const c = parseMoneyToCents(raw);
        if (c === null) problems.push(`Linha ${line}: valor «${raw.slice(0, 30)}» em «${f.label}» não é um valor em reais válido.`);
        else rec[f.out] = c;
      } else if (f.kind === 'date') {
        const dte = parseDateFlexible(raw);
        if (dte === null) problems.push(`Linha ${line}: data «${raw.slice(0, 30)}» inválida (use DD/MM/AAAA).`);
        else rec[f.out] = dte;
      } else if (f.kind === 'status') {
        rec[f.out] = parseStatus(raw);
      } else if (f.kind === 'number') {
        const n = raw.replace(',', '.');
        if (/^\d+(\.\d+)?$/.test(n)) rec[f.out] = n;
        else problems.push(`Linha ${line}: quantidade «${raw.slice(0, 30)}» inválida.`);
      } else {
        rec[f.out] = raw;
      }
    }
    rows.push(rec);
  });
  return { rows, problems: problems.slice(0, 50) };
}
