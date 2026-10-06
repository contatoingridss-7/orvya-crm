// Leitura dos relatórios do sistema Net Use (IC Supra e LocPress).
// Recebe as linhas já separadas em colunas (como o pdf.js entrega) e devolve só
// dados de produto. Preço de custo e nomes de clientes são descartados aqui:
// não saem do navegador.

export type CompanyHint = "ic-supra" | "locpress" | null;

export type StockItem = { code: string; name: string; unit: string | null; qty: number };
export type SalesItem = { code: string; name: string; unit: string | null; qty: number; total: number };
export type ServiceSaleItem = { code: string; name: string; unit: string | null; prices: number[]; rental: boolean };

export type NetUseReport =
  | { kind: "estoque"; company: CompanyHint; issuedAt: string | null; items: StockItem[] }
  | { kind: "vendas"; company: CompanyHint; period: string | null; items: SalesItem[] }
  | { kind: "servicos"; company: CompanyHint; period: string | null; items: ServiceSaleItem[] }
  | { kind: "desconhecido"; company: CompanyHint };

const MONEY = /^-?\d{1,3}(\.\d{3})*,\d{2}$|^-?\d+,\d{2}$/;
const CODE = /^\d{1,8}$/;
const NCM = /^\d{8}$/;
const UNIT = /^[A-ZÇ]{1,4}$/;

/** "1.234,56" → 1234.56 */
export function parseBRNumber(value: string): number {
  return Number(value.replace(/\./g, "").replace(",", "."));
}

function clean(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function detectCompany(text: string): CompanyHint {
  if (/IC SUPRA HOSPITALAR|IC L LOPES/i.test(text)) return "ic-supra";
  if (/LOCPRESS|SOARES E MENDES/i.test(text)) return "locpress";
  return null;
}

function findPeriod(text: string): string | null {
  const m = text.match(/(\d{2}\/\d{2}\/\d{4})\s*a\s*(\d{2}\/\d{2}\/\d{4})/);
  return m ? `${m[1]} a ${m[2]}` : null;
}

/** Identifica o tipo do relatório pelo cabeçalho e lê os itens. */
export function parseNetUse(rows: string[][]): NetUseReport {
  const head = rows.slice(0, 40).map((r) => r.join(" ")).join("\n");
  const company = detectCompany(head);

  if (/Estoque x Pre[çc]o Custo/i.test(head)) {
    const issued = head.match(/Emitido em:\s*(\d{2}\/\d{2}\/\d{4})/);
    return { kind: "estoque", company, issuedAt: issued?.[1] ?? null, items: parseStock(rows) };
  }
  if (/Movimento Sint[ée]tico Vendas/i.test(head)) {
    return { kind: "vendas", company, period: findPeriod(head), items: parseSales(rows) };
  }
  if (/Acompanhamento de Vendas e Servi[çc]os/i.test(head)) {
    return { kind: "servicos", company, period: findPeriod(head), items: parseServiceSales(rows) };
  }
  return { kind: "desconhecido", company };
}

/**
 * "Inventário: Estoque x Preço Custo"
 * Colunas: Código | Barras/Ref. | Descrição | Unidade | Preço Custo | QUANTIDADE | R$ TOTAL
 */
function parseStock(rows: string[][]): StockItem[] {
  const items: StockItem[] = [];
  for (const r of rows) {
    if (r.length < 6 || !CODE.test(r[0] ?? "")) continue;
    const tail = r.slice(-3);
    if (!tail.every((c) => MONEY.test(c))) continue;
    // O meio é: barras, descrição e (às vezes) unidade separada.
    const middle = r.slice(1, -3);
    const unit = middle.length >= 3 && UNIT.test(middle.at(-1) ?? "") ? (middle.pop() ?? null) : null;
    const name = clean(middle.slice(1).join(" "));
    if (!name) continue;
    items.push({ code: r[0]!, name, unit, qty: parseBRNumber(tail[1]!) });
  }
  return items;
}

/**
 * "Movimento Sintético Vendas"
 * Colunas: Código | Código Barras | Descrição | UND | Qtde.Notas | Qtde.Volumes | Tot.Comissões | Tot.Vendas
 */
function parseSales(rows: string[][]): SalesItem[] {
  const items: SalesItem[] = [];
  for (const r of rows) {
    if (r.length < 7 || !CODE.test(r[0] ?? "")) continue;
    const tail = r.slice(-4);
    if (!tail.every((c) => MONEY.test(c))) continue;
    const middle = r.slice(1, -4);
    const unit = middle.length >= 3 && UNIT.test(middle.at(-1) ?? "") ? (middle.pop() ?? null) : null;
    const name = clean(middle.slice(1).join(" "));
    if (!name) continue;
    items.push({ code: r[0]!, name, unit, qty: parseBRNumber(tail[1]!), total: parseBRNumber(tail[3]!) });
  }
  return items;
}

/**
 * "Acompanhamento de Vendas e Serviços" (LocPress)
 * Colunas do item: [Técnico] | CÓDIGO | DESCRIÇÃO | NCM | UNIDADE | PREÇO | QUANTIDADE | FORNECEDOR | VENDEDOR
 * O relatório repete o mesmo pedido mais de uma vez: cada (pedido, código, preço) conta uma vez.
 */
function parseServiceSales(rows: string[][]): ServiceSaleItem[] {
  const byCode = new Map<string, ServiceSaleItem>();
  const seen = new Set<string>();
  let order = "";

  for (const r of rows) {
    if (/^\d{6}$/.test(r[0] ?? "") && /^\d{2}\/\d{2}\/\d{4}$/.test(r[1] ?? "")) {
      order = r[0]!;
      continue;
    }
    const ncmAt = r.findIndex((c) => NCM.test(c));
    if (ncmAt < 2) continue;
    const codeAt = ncmAt - 2;
    const code = r[codeAt] ?? "";
    const price = r[ncmAt + 2] ?? "";
    if (!CODE.test(code) || !MONEY.test(price)) continue;

    const name = clean(r[ncmAt - 1] ?? "");
    const unit = UNIT.test(r[ncmAt + 1] ?? "") ? r[ncmAt + 1]! : null;
    const value = parseBRNumber(price);
    const key = `${order}|${code}|${value}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const item = byCode.get(code) ?? { code, name, unit, prices: [], rental: /LOCA[CÇ][AÃ]O/i.test(name) };
    item.prices.push(value);
    byCode.set(code, item);
  }
  return [...byCode.values()];
}
