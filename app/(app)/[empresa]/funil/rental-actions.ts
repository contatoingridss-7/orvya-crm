"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isManager } from "@/lib/auth/roles";
import { getViewer } from "@/lib/auth/viewer";
import { parseMoneyInput } from "@/lib/catalog/types";
import { createClient } from "@/lib/supabase/server";

export type ActionResult = { ok: true; message: string } | { ok: false; error: string };

async function context(slug: string) {
  const viewer = await getViewer();
  if (!viewer?.active) return null;
  const company = viewer.companies.find((c) => c.slug === slug);
  if (!company) return null;
  return { viewer, company, manager: isManager(company.role), supabase: await createClient() };
}
type Ctx = NonNullable<Awaited<ReturnType<typeof context>>>;

const NO_ACCESS = { ok: false as const, error: "Sem acesso a esta empresa." };

/** Vendedor só mexe nos contratos dos leads dele; gestor em todos. */
async function editableLead(ctx: Ctx, leadId: string) {
  const { data } = await ctx.supabase
    .from("leads")
    .select("id, owner_id")
    .eq("id", leadId)
    .eq("company_id", ctx.company.id)
    .maybeSingle<{ id: string; owner_id: string | null }>();
  if (!data) return null;
  return ctx.manager || data.owner_id === ctx.viewer.id ? data : null;
}

function refresh(slug: string) {
  revalidatePath(`/${slug}/funil`);
  revalidatePath(`/${slug}/painel`);
  revalidatePath(`/${slug}/catalogo`);
}

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Informe a data.");

const contractSchema = z
  .object({
    productId: z.string(),
    serialNumber: z.string().trim().max(60),
    startDate: date,
    endDate: date,
    monthlyValue: z.string().transform((v, c) => {
      const n = parseMoneyInput(v);
      if (n === "invalid" || n === null || n <= 0) {
        c.addIssue({ code: "custom", message: "Informe o valor mensal combinado." });
        return z.NEVER;
      }
      return n;
    }),
    deliveryAddress: z.string().trim().max(300),
    renewOf: z.string().optional(),
  })
  .refine((d) => d.endDate >= d.startDate, { message: "O fim precisa ser depois do início." });

export type ContractInput = z.input<typeof contractSchema>;

export async function saveContract(slug: string, leadId: string, input: ContractInput): Promise<ActionResult> {
  const ctx = await context(slug);
  if (!ctx) return NO_ACCESS;
  const parsed = contractSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  const d = parsed.data;
  if (!(await editableLead(ctx, leadId))) return { ok: false, error: "Só o responsável pelo lead ou o gestor registra contratos." };

  if (d.productId) {
    const { data: product } = await ctx.supabase.from("products").select("id").eq("id", d.productId).eq("company_id", ctx.company.id).maybeSingle();
    if (!product) return { ok: false, error: "Equipamento não encontrado no catálogo." };
  }

  const { error } = await ctx.supabase.from("rental_contracts").insert({
    company_id: ctx.company.id,
    lead_id: leadId,
    product_id: d.productId || null,
    serial_number: d.serialNumber || null,
    start_date: d.startDate,
    end_date: d.endDate,
    monthly_value: d.monthlyValue,
    delivery_address: d.deliveryAddress || null,
    status: "ativo",
  });
  if (error) return { ok: false, error: "Não foi possível salvar o contrato." };

  // Renovação: só depois de gravar o novo, o anterior passa a "renovado".
  if (d.renewOf) {
    await ctx.supabase.from("rental_contracts").update({ status: "renovado" }).eq("id", d.renewOf).eq("lead_id", leadId).eq("status", "ativo");
  }

  await ctx.supabase.from("activities").insert({
    company_id: ctx.company.id,
    lead_id: leadId,
    kind: "note",
    user_id: ctx.viewer.id,
    body: d.renewOf ? `Contrato de locação renovado até ${d.endDate.split("-").reverse().join("/")}.` : `Contrato de locação registrado até ${d.endDate.split("-").reverse().join("/")}.`,
  });

  refresh(slug);
  return { ok: true, message: d.renewOf ? "Contrato renovado." : "Contrato registrado." };
}

export async function endContract(slug: string, leadId: string, contractId: string): Promise<ActionResult> {
  const ctx = await context(slug);
  if (!ctx) return NO_ACCESS;
  if (!(await editableLead(ctx, leadId))) return { ok: false, error: "Só o responsável pelo lead ou o gestor encerra contratos." };

  const { data, error } = await ctx.supabase
    .from("rental_contracts")
    .update({ status: "encerrado" })
    .eq("id", contractId)
    .eq("lead_id", leadId)
    .eq("status", "ativo")
    .select("id");
  if (error || !data?.length) return { ok: false, error: "Não foi possível encerrar o contrato." };

  await ctx.supabase.from("activities").insert({
    company_id: ctx.company.id,
    lead_id: leadId,
    kind: "note",
    user_id: ctx.viewer.id,
    body: "Contrato de locação encerrado. Equipamento a recolher.",
  });

  refresh(slug);
  return { ok: true, message: "Contrato encerrado." };
}
