export type Product = {
  id: string;
  code: string | null;
  name: string;
  category: string | null;
  unit: string | null;
  salePrice: number | null;
  rentPriceMonth: number | null;
  stock: number;
  rentedCount: number;
  promoLabel: string | null;
  aiNotes: string | null;
  active: boolean;
  isRental: boolean;
  requiresHuman: boolean;
  referencePrice: number | null;
  referenceQty: number | null;
  referenceNote: string | null;
  stockUpdatedAt: string | null;
};

export const PRODUCT_COLUMNS =
  "id, code, name, category, unit, sale_price, rent_price_month, stock, rented_count, promo_label, ai_notes, active, is_rental, requires_human, reference_price, reference_qty, reference_note, stock_updated_at";

export type ProductRow = {
  id: string;
  code: string | null;
  name: string;
  category: string | null;
  unit: string | null;
  sale_price: number | string | null;
  rent_price_month: number | string | null;
  stock: number;
  rented_count: number;
  promo_label: string | null;
  ai_notes: string | null;
  active: boolean;
  is_rental: boolean;
  requires_human: boolean;
  reference_price: number | string | null;
  reference_qty: number | string | null;
  reference_note: string | null;
  stock_updated_at: string | null;
};

// O PostgREST devolve numeric como texto; converte uma vez aqui.
const n = (v: number | string | null) => (v === null ? null : Number(v));

export function toProduct(r: ProductRow): Product {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    category: r.category,
    unit: r.unit,
    salePrice: n(r.sale_price),
    rentPriceMonth: n(r.rent_price_month),
    stock: r.stock,
    rentedCount: r.rented_count,
    promoLabel: r.promo_label,
    aiNotes: r.ai_notes,
    active: r.active,
    isRental: r.is_rental,
    requiresHuman: r.requires_human,
    referencePrice: n(r.reference_price),
    referenceQty: n(r.reference_qty),
    referenceNote: r.reference_note,
    stockUpdatedAt: r.stock_updated_at,
  };
}

/** "1.234,56" / "1234.56" / "" → número ou null. */
export function parseMoneyInput(value: string): number | null | "invalid" {
  const s = value.replace(/R\$\s?/i, "").replace(/\s/g, "");
  if (!s) return null;
  const normalized = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
  const v = Number(normalized);
  return Number.isFinite(v) && v >= 0 ? Math.round(v * 100) / 100 : "invalid";
}
