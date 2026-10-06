// Monta a prévia da importação: junta relatórios do Net Use, planilha e o catálogo atual.
// Nada aqui grava no banco; a gravação recebe só as linhas marcadas.

import { suggestCategory } from "./categories";
import type { NetUseReport } from "./netuse";
import type { SheetRow } from "./spreadsheet";

export type ExistingProduct = {
  id: string;
  code: string | null;
  name: string;
  active: boolean;
  stock: number;
  salePrice: number | null;
  isRental: boolean;
};

export type PlanRow = {
  key: string;
  existingId: string | null;
  existingActive: boolean;
  code: string | null;
  name: string;
  category: string | null;
  unit: string | null;
  stockOld: number | null;
  stockNew: number | null;
  soldQty: number;
  referencePrice: number | null;
  referenceNote: string | null;
  salePrice: number | null;
  clearSalePrice: boolean;
  rentPrice: number | null;
  isRental: boolean | null;
  aiNotes: string | null;
  activeFromSheet: boolean | null;
  fromSheet: boolean;
  /** Alerta para o gestor conferir (ex.: preço muito variável, provável locação). */
  warning: string | null;
  errors: string[];
  selected: boolean;
};

export type ImportPlan = {
  rows: PlanRow[];
  /** Produtos do catálogo que não estão no relatório de estoque (têm estoque zero no Net Use). */
  missingFromStock: ExistingProduct[];
  hasStockReport: boolean;
  summary: string[];
};

/** Linha enviada ao servidor (formato de public.import_products). */
export type ImportPayloadRow = {
  code: string | null;
  name: string | null;
  unit: string | null;
  category: string | null;
  stock: number | null;
  sale_price: number | null;
  clear_sale_price: boolean | null;
  rent_price_month: number | null;
  is_rental: boolean | null;
  requires_human: boolean | null;
  reference_price: number | null;
  reference_qty: number | null;
  reference_note: string | null;
  ai_notes: string | null;
  active: boolean | null;
  source: "netuse" | "planilha";
};

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const nameKey = (name: string) => name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

export function buildPlan(existing: ExistingProduct[], reports: NetUseReport[], sheet: SheetRow[] | null): ImportPlan {
  const byCode = new Map(existing.filter((p) => p.code).map((p) => [p.code!, p]));
  const byName = new Map(existing.map((p) => [nameKey(p.name), p]));
  const rows = new Map<string, PlanRow>();

  const row = (code: string | null, name: string): PlanRow => {
    const key = code ? `c:${code}` : `n:${nameKey(name)}`;
    let r = rows.get(key);
    if (!r) {
      const ex = (code ? byCode.get(code) : byName.get(nameKey(name))) ?? null;
      r = {
        key,
        existingId: ex?.id ?? null,
        existingActive: ex?.active ?? false,
        code,
        name: ex?.name ?? name,
        category: ex ? null : suggestCategory(name),
        unit: null,
        stockOld: ex?.stock ?? null,
        stockNew: null,
        soldQty: 0,
        referencePrice: null,
        referenceNote: null,
        salePrice: null,
        clearSalePrice: false,
        rentPrice: null,
        isRental: null,
        aiNotes: null,
        activeFromSheet: null,
        fromSheet: false,
        warning: null,
        errors: [],
        selected: false,
      };
      rows.set(key, r);
    }
    return r;
  };

  const summary: string[] = [];
  const stockReports = reports.filter((r) => r.kind === "estoque");
  const salesReports = reports.filter((r) => r.kind === "vendas");
  const serviceReports = reports.filter((r) => r.kind === "servicos");

  // Estoque
  const stockCodes = new Set<string>();
  for (const rep of stockReports) {
    for (const it of rep.items) {
      const r = row(it.code, it.name);
      r.stockNew = Math.round(it.qty);
      r.unit = it.unit ?? r.unit;
      stockCodes.add(it.code);
    }
  }
  if (stockReports.length) {
    const issued = [...new Set(stockReports.map((r) => r.issuedAt).filter(Boolean))].join(", ");
    summary.push(`Estoque: ${stockCodes.size} produtos${issued ? ` (emitido em ${issued})` : ""}`);
  }

  // Vendas IC Supra: preço médio = total vendido ÷ quantidade, somando os períodos
  const totals = new Map<string, { qty: number; total: number }>();
  for (const rep of salesReports) {
    for (const it of rep.items) {
      const r = row(it.code, it.name);
      r.unit = r.unit ?? it.unit;
      if (it.qty > 0) {
        const t = totals.get(it.code) ?? { qty: 0, total: 0 };
        t.qty += it.qty;
        t.total += it.total;
        totals.set(it.code, t);
      }
    }
  }
  const salesPeriod = salesReports.map((r) => r.period).filter(Boolean).join(" e ");
  for (const [code, t] of totals) {
    const r = rows.get(`c:${code}`)!;
    r.soldQty = t.qty;
    if (t.total > 0) {
      r.referencePrice = round2(t.total / t.qty);
      r.referenceNote = `Média de ${t.qty.toLocaleString("pt-BR")} un. vendidas${salesPeriod ? ` (${salesPeriod})` : ""}`;
    }
  }
  if (salesReports.length) summary.push(`Vendas: ${totals.size} produtos vendidos${salesPeriod ? ` (${salesPeriod})` : ""}`);

  // Vendas e serviços LocPress: mediana dos preços; locação nunca tem preço de referência
  for (const rep of serviceReports) {
    for (const it of rep.items) {
      const r = row(it.code, it.name);
      r.unit = r.unit ?? it.unit;
      r.soldQty += it.prices.length;
      const min = Math.min(...it.prices);
      const max = Math.max(...it.prices);
      if (it.rental) {
        r.isRental = true;
      } else if (it.prices.length && min > 0 && max / min >= 2) {
        // Ex.: concentrador por R$ 30, 150 e 300 no mesmo mês — mistura locação (diária, semanal, mensal) e venda.
        r.warning = `Preços de ${brl(min)} a ${brl(max)} no período: pode ser locação. Defina o preço com a equipe.`;
      } else if (it.prices.length) {
        r.referencePrice = round2(median(it.prices));
        r.referenceNote = `Mediana de ${it.prices.length} venda(s)${rep.period ? ` (${rep.period})` : ""}`;
      }
    }
    summary.push(`Vendas e serviços: ${rep.items.length} produtos${rep.period ? ` (${rep.period})` : ""}`);
  }

  // Planilha: valores explícitos têm prioridade
  for (const s of sheet ?? []) {
    if (!s.code && !s.name) continue;
    const r = row(s.code, s.name ?? s.code ?? "");
    r.fromSheet = true;
    if (s.name) r.name = s.name; // nome da planilha também renomeia produto existente
    r.category = s.category ?? r.category;
    r.unit = s.unit ?? r.unit;
    r.stockNew = s.stock ?? r.stockNew;
    r.salePrice = s.salePrice;
    r.clearSalePrice = s.clearSalePrice;
    r.rentPrice = s.rentPrice;
    r.isRental = s.isRental ?? r.isRental;
    r.aiNotes = s.aiNotes;
    r.activeFromSheet = s.active;
    r.errors.push(...s.errors.map((e) => `linha ${s.line}: ${e}`));
    if (!r.existingId && !s.name) r.errors.push(`linha ${s.line}: produto novo precisa de nome`);
  }
  if (sheet) summary.push(`Planilha: ${sheet.length} linhas`);

  // Com relatório de estoque, código que não aparece nele está zerado no Net Use.
  const hasStock = stockReports.length > 0;
  if (hasStock) {
    for (const r of rows.values()) {
      if (r.code && r.stockNew === null && !stockCodes.has(r.code)) r.stockNew = 0;
    }
  }

  // O que vem marcado
  for (const r of rows.values()) {
    if (r.errors.length) r.selected = false;
    else if (r.existingId) r.selected = r.existingActive || r.fromSheet;
    else if (r.fromSheet) r.selected = true;
    else if (r.isRental) r.selected = true;
    else r.selected = r.soldQty > 0 && (!hasStock || (r.stockNew ?? 0) > 0);
  }

  // Produtos do catálogo que não vieram em nenhum arquivo (só existe opção de zerar o estoque deles).
  const missingFromStock = hasStock
    ? existing.filter((p) => p.active && p.code && !stockCodes.has(p.code) && p.stock !== 0 && !rows.has(`c:${p.code}`))
    : [];

  const sorted = [...rows.values()].sort((a, b) => Number(b.selected) - Number(a.selected) || b.soldQty - a.soldQty || a.name.localeCompare(b.name, "pt-BR"));
  return { rows: sorted, missingFromStock, hasStockReport: hasStock, summary };
}

/** Converte as escolhas da prévia no que o banco recebe. */
export function toPayload(plan: ImportPlan, selectedKeys: Set<string>, zeroMissing: boolean) {
  const rows: ImportPayloadRow[] = [];
  const deactivate: string[] = [];

  for (const r of plan.rows) {
    const selected = selectedKeys.has(r.key);
    if (!selected) {
      if (r.existingId && r.existingActive) deactivate.push(r.existingId);
      continue;
    }
    const rental = r.isRental === true;
    rows.push({
      code: r.code,
      // Nome do Net Use só entra em produto novo; o gestor pode ter ajustado o nome no catálogo.
      name: r.existingId && !r.fromSheet ? null : r.name,
      unit: r.unit,
      category: r.existingId && !r.fromSheet ? null : r.category,
      stock: r.stockNew,
      sale_price: rental ? null : r.salePrice,
      clear_sale_price: r.clearSalePrice || null,
      rent_price_month: r.rentPrice,
      is_rental: r.isRental,
      requires_human: rental ? true : null,
      reference_price: r.referencePrice,
      reference_qty: r.referencePrice !== null ? r.soldQty : null,
      reference_note: r.referenceNote,
      ai_notes: r.aiNotes,
      active: r.existingId && !r.existingActive ? true : r.activeFromSheet,
      source: r.fromSheet ? "planilha" : "netuse",
    });
  }

  if (zeroMissing) {
    for (const p of plan.missingFromStock) {
      rows.push({
        code: p.code, name: null, unit: null, category: null, stock: 0, sale_price: null, clear_sale_price: null,
        rent_price_month: null, is_rental: null, requires_human: null, reference_price: null, reference_qty: null,
        reference_note: null, ai_notes: null, active: null, source: "netuse",
      });
    }
  }
  return { rows, deactivate };
}
