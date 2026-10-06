"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isManager } from "@/lib/auth/roles";
import { getViewer } from "@/lib/auth/viewer";
import { parseMoneyInput } from "@/lib/catalog/types";
import { createClient } from "@/lib/supabase/server";

export type ActionResult = { ok: true; message: string; id?: string } | { ok: false; error: string };

/** Gestor ou admin da empresa (o RLS confere de novo no banco). */
async function managerCompany(slug: string) {
  const viewer = await getViewer();
  if (!viewer?.active) return null;
  const company = viewer.companies.find((c) => c.slug === slug);
  return company && isManager(company.role) ? company : null;
}

function refresh(slug: string) {
  revalidatePath(`/${slug}/catalogo`);
}

const NOT_ALLOWED: ActionResult = { ok: false, error: "Só gestor ou administrador altera o catálogo." };

// ---------------------------------------------------------------------
// Produto (novo ou edição)
// ---------------------------------------------------------------------
const money = z.string().transform((v, ctx) => {
  const parsed = parseMoneyInput(v);
  if (parsed === "invalid") {
    ctx.addIssue({ code: "custom", message: "Valor inválido. Use o formato 1.234,56." });
    return z.NEVER;
  }
  return parsed;
});

const productSchema = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(2, "Informe o nome do produto."),
  code: z.string().trim().max(40).transform((v) => v || null),
  category: z.string().trim().max(60).transform((v) => v || null),
  unit: z.string().trim().max(6).transform((v) => v.toUpperCase() || null),
  salePrice: money,
  rentPriceMonth: money,
  stock: z.coerce.number().int("Estoque precisa ser um número inteiro."),
  promoLabel: z.string().trim().max(60).transform((v) => v || null),
  aiNotes: z.string().trim().max(1000).transform((v) => v || null),
  isRental: z.boolean(),
  requiresHuman: z.boolean(),
  active: z.boolean(),
});

export type ProductInput = z.input<typeof productSchema>;

export async function saveProduct(slug: string, input: ProductInput): Promise<ActionResult> {
  const company = await managerCompany(slug);
  if (!company) return NOT_ALLOWED;

  const parsed = productSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  const p = parsed.data;

  const values = {
    name: p.name,
    code: p.code,
    category: p.category,
    unit: p.unit,
    // Item negociado pela equipe não tem preço que a IA possa informar.
    sale_price: p.requiresHuman && p.isRental ? null : p.salePrice,
    rent_price_month: p.isRental ? p.rentPriceMonth : null,
    stock: p.stock,
    // rented_count é contado pelos contratos ativos (migration 0005)
    promo_label: p.promoLabel,
    ai_notes: p.aiNotes,
    is_rental: p.isRental,
    requires_human: p.requiresHuman,
    active: p.active,
  };

  const supabase = await createClient();
  const query = p.id
    ? supabase.from("products").update(values).eq("id", p.id).eq("company_id", company.id).select("id").single()
    : supabase.from("products").insert({ ...values, company_id: company.id, source: "manual" }).select("id").single();
  const { data, error } = await query;

  if (error) {
    if (error.code === "23505") return { ok: false, error: `Já existe um produto com o código ${p.code}.` };
    return { ok: false, error: "Não foi possível salvar o produto." };
  }
  refresh(slug);
  return { ok: true, message: p.id ? "Produto atualizado." : "Produto cadastrado.", id: data.id };
}

// ---------------------------------------------------------------------
// Usar o preço de referência como preço confirmado
// ---------------------------------------------------------------------
export async function confirmReferencePrices(slug: string, ids: string[]): Promise<ActionResult> {
  const company = await managerCompany(slug);
  if (!company) return NOT_ALLOWED;
  const parsed = z.array(z.uuid()).min(1).max(5000).safeParse(ids);
  if (!parsed.success) return { ok: false, error: "Nenhum produto selecionado." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("confirm_reference_prices", { p_company: company.id, p_ids: parsed.data });
  if (error) return { ok: false, error: "Não foi possível confirmar os preços." };

  refresh(slug);
  const count = Number(data ?? 0);
  return {
    ok: true,
    message: count
      ? `${count} preço(s) confirmado(s) a partir da referência.`
      : "Nenhum preço alterado (os selecionados já tinham preço, não têm referência ou são negociados pela equipe).",
  };
}

// ---------------------------------------------------------------------
// Importação (Net Use e planilha)
// ---------------------------------------------------------------------
const nullableText = z.string().trim().max(300).nullable();
const nullableNumber = z.number().finite().nullable();

const importRowSchema = z.object({
  code: z.string().trim().max(40).nullable(),
  name: nullableText,
  unit: z.string().trim().max(6).nullable(),
  category: z.string().trim().max(60).nullable(),
  stock: z.number().int().nullable(),
  sale_price: nullableNumber,
  clear_sale_price: z.boolean().nullable(),
  rent_price_month: nullableNumber,
  is_rental: z.boolean().nullable(),
  requires_human: z.boolean().nullable(),
  reference_price: nullableNumber,
  reference_qty: nullableNumber,
  reference_note: nullableText,
  ai_notes: z.string().trim().max(1000).nullable(),
  active: z.boolean().nullable(),
  source: z.enum(["netuse", "planilha"]),
});

const importSchema = z.object({
  rows: z.array(importRowSchema).max(15000),
  deactivate: z.array(z.uuid()).max(15000),
});

export async function applyImport(slug: string, input: z.input<typeof importSchema>): Promise<ActionResult> {
  const company = await managerCompany(slug);
  if (!company) return NOT_ALLOWED;

  const parsed = importSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Dados da importação inválidos. Recarregue a página e tente de novo." };
  const { rows, deactivate } = parsed.data;
  if (!rows.length && !deactivate.length) return { ok: false, error: "Nada para importar." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("import_products", {
    p_company: company.id,
    p_rows: rows,
    p_deactivate: deactivate,
  });
  if (error) {
    if (error.code === "23505") return { ok: false, error: "Há produtos com o mesmo código na importação." };
    return { ok: false, error: `Não foi possível importar: ${error.message}` };
  }

  refresh(slug);
  const r = data as { inserted: number; updated: number; deactivated: number };
  const parts = [
    r.inserted && `${r.inserted} novo(s)`,
    r.updated && `${r.updated} atualizado(s)`,
    r.deactivated && `${r.deactivated} retirado(s) do catálogo`,
  ].filter(Boolean);
  return { ok: true, message: parts.length ? `Importação concluída: ${parts.join(", ")}.` : "Nada mudou." };
}
