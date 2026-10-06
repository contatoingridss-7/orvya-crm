"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isManager } from "@/lib/auth/roles";
import { getViewer } from "@/lib/auth/viewer";
import { parseMoneyInput } from "@/lib/catalog/types";
import type { LeadDetail } from "@/lib/crm/types";
import { toE164 } from "@/lib/phone";
import { createClient } from "@/lib/supabase/server";

export type ActionResult<T = undefined> = { ok: true; message?: string; data?: T } | { ok: false; error: string };

async function context(slug: string) {
  const viewer = await getViewer();
  if (!viewer?.active) return null;
  const company = viewer.companies.find((c) => c.slug === slug);
  if (!company) return null;
  return { viewer, company, manager: isManager(company.role), supabase: await createClient() };
}
type Ctx = NonNullable<Awaited<ReturnType<typeof context>>>;

const NO_ACCESS = { ok: false as const, error: "Sem acesso a esta empresa." };

function refresh(slug: string) {
  revalidatePath(`/${slug}/funil`);
}

type LeadInfo = { id: string; owner_id: string | null; pipeline_id: string; stage_id: string; contact_id: string };

/** Carrega o lead pelo cliente do usuário (o RLS já esconde o que ele não vê). */
async function loadLead(ctx: Ctx, leadId: string) {
  const { data } = await ctx.supabase
    .from("leads")
    .select("id, owner_id, pipeline_id, stage_id, contact_id")
    .eq("id", leadId)
    .eq("company_id", ctx.company.id)
    .maybeSingle<LeadInfo>();
  return data;
}

/** Vendedor só altera os leads dele (SPEC 1). Lead sem responsável ele precisa pegar antes. */
function canEdit(ctx: Ctx, lead: LeadInfo) {
  return ctx.manager || lead.owner_id === ctx.viewer.id;
}

function dbError(message: string | undefined, fallback: string) {
  if (message?.includes("motivo da perda")) return "Informe o motivo da perda.";
  if (message?.includes("Etapa não pertence")) return "Essa etapa não é deste funil.";
  return fallback;
}

// ---------------------------------------------------------------------
// Novo lead
// ---------------------------------------------------------------------
const money = z.string().transform((v, c) => {
  const n = parseMoneyInput(v);
  if (n === "invalid") {
    c.addIssue({ code: "custom", message: "Valor inválido. Use o formato 1.234,56." });
    return z.NEVER;
  }
  return n ?? 0;
});

const newLeadSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome do contato."),
  phone: z.string().trim(),
  email: z.string().trim().toLowerCase().refine((v) => !v || z.email().safeParse(v).success, "E-mail inválido."),
  org: z.string().trim().max(120),
  customerType: z.enum(["B2C", "B2B"]),
  pipelineId: z.uuid(),
  stageId: z.string(),
  value: money,
  temperature: z.enum(["quente", "morno", "frio"]),
  sourceId: z.string(),
  ownerId: z.string(),
});

export async function createLead(slug: string, input: z.input<typeof newLeadSchema>): Promise<ActionResult<{ id: string }>> {
  const ctx = await context(slug);
  if (!ctx) return NO_ACCESS;
  const parsed = newLeadSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  const d = parsed.data;

  const phone = d.phone ? toE164(d.phone) : null;
  if (d.phone && !phone) return { ok: false, error: "Telefone inválido. Use DDD + número, ex.: (86) 99999-0000." };

  const { data: stages } = await ctx.supabase
    .from("stages")
    .select("id, kind, position")
    .eq("pipeline_id", d.pipelineId)
    .eq("company_id", ctx.company.id)
    .order("position")
    .returns<{ id: string; kind: string; position: number }[]>();
  if (!stages?.length) return { ok: false, error: "Funil não encontrado." };
  const stage = d.stageId ? stages.find((s) => s.id === d.stageId) : stages.find((s) => s.kind === "open");
  if (!stage) return { ok: false, error: "Etapa não encontrada." };
  if (stage.kind === "lost") return { ok: false, error: "Um lead novo não pode começar como perdido." };

  // Vendedor que cadastra o lead fica com ele; gestor escolhe (ou deixa na fila).
  const ownerId = ctx.manager ? d.ownerId || null : ctx.viewer.id;

  // Contato: reaproveita quem já existe com o mesmo telefone na empresa.
  let contactId: string | null = null;
  if (phone) {
    const { data: existing } = await ctx.supabase
      .from("contacts")
      .select("id")
      .eq("company_id", ctx.company.id)
      .eq("phone_e164", phone)
      .maybeSingle<{ id: string }>();
    contactId = existing?.id ?? null;
  }
  if (!contactId) {
    const { data: contact, error } = await ctx.supabase
      .from("contacts")
      .insert({
        company_id: ctx.company.id,
        name: d.name,
        phone_e164: phone,
        email: d.email || null,
        org_name: d.org || null,
        customer_type: d.customerType,
      })
      .select("id")
      .single<{ id: string }>();
    if (error || !contact) return { ok: false, error: "Não foi possível cadastrar o contato." };
    contactId = contact.id;
  }

  const { data: lead, error } = await ctx.supabase
    .from("leads")
    .insert({
      company_id: ctx.company.id,
      contact_id: contactId,
      pipeline_id: d.pipelineId,
      stage_id: stage.id,
      owner_id: ownerId,
      value: d.value,
      temperature: d.temperature,
      source_id: d.sourceId || null,
      last_contact_at: new Date().toISOString(),
    })
    .select("id")
    .single<{ id: string }>();
  if (error || !lead) return { ok: false, error: dbError(error?.message, "Não foi possível criar o lead.") };

  refresh(slug);
  return { ok: true, message: `${d.name} entrou no funil.`, data: { id: lead.id } };
}

// ---------------------------------------------------------------------
// Mover de etapa (arrastar, seletor de etapa, ganho, perda)
// ---------------------------------------------------------------------
export async function moveLead(
  slug: string,
  leadId: string,
  stageId: string,
  lostReason?: string,
): Promise<ActionResult<{ tasks: string[]; tookLead: boolean }>> {
  const ctx = await context(slug);
  if (!ctx) return NO_ACCESS;
  const lead = await loadLead(ctx, leadId);
  if (!lead) return { ok: false, error: "Lead não encontrado." };

  // Vendedor que move um lead da fila passa a ser o responsável (SPEC: "pegar lead").
  const tookLead = !ctx.manager && lead.owner_id === null;
  if (!tookLead && !canEdit(ctx, lead)) return { ok: false, error: "Este lead é de outro vendedor." };

  const { data: stage } = await ctx.supabase
    .from("stages")
    .select("id, kind, name")
    .eq("id", stageId)
    .eq("pipeline_id", lead.pipeline_id)
    .maybeSingle<{ id: string; kind: string; name: string }>();
  if (!stage) return { ok: false, error: "Essa etapa não é deste funil." };
  if (stage.kind === "lost" && !lostReason?.trim()) return { ok: false, error: "Informe o motivo da perda." };

  const startedAt = new Date(Date.now() - 2000).toISOString();
  const { error } = await ctx.supabase
    .from("leads")
    .update({
      stage_id: stageId,
      lost_reason: stage.kind === "lost" ? lostReason!.trim().slice(0, 200) : null,
      ...(tookLead ? { owner_id: ctx.viewer.id } : {}),
    })
    .eq("id", leadId);
  if (error) return { ok: false, error: dbError(error.message, "Não foi possível mudar a etapa.") };

  // Tarefas que o banco acabou de criar pelas automações desta etapa.
  const { data: tasks } = await ctx.supabase
    .from("tasks")
    .select("title")
    .eq("lead_id", leadId)
    .eq("origin", "automation")
    .gte("created_at", startedAt)
    .returns<{ title: string }[]>();

  refresh(slug);
  return { ok: true, message: `Lead movido para ${stage.name}.`, data: { tasks: (tasks ?? []).map((t) => t.title), tookLead } };
}

/** Troca de funil: o lead vai para a primeira etapa do novo funil. */
export async function changePipeline(slug: string, leadId: string, pipelineId: string): Promise<ActionResult> {
  const ctx = await context(slug);
  if (!ctx) return NO_ACCESS;
  const lead = await loadLead(ctx, leadId);
  if (!lead) return { ok: false, error: "Lead não encontrado." };
  if (!canEdit(ctx, lead)) return { ok: false, error: "Este lead é de outro vendedor." };

  const { data: first } = await ctx.supabase
    .from("stages")
    .select("id")
    .eq("pipeline_id", pipelineId)
    .eq("company_id", ctx.company.id)
    .eq("kind", "open")
    .order("position")
    .limit(1)
    .maybeSingle<{ id: string }>();
  if (!first) return { ok: false, error: "Funil não encontrado." };

  const { error } = await ctx.supabase.from("leads").update({ pipeline_id: pipelineId, stage_id: first.id, lost_reason: null }).eq("id", leadId);
  if (error) return { ok: false, error: dbError(error.message, "Não foi possível trocar o funil.") };
  refresh(slug);
  return { ok: true, message: "Lead mudou de funil." };
}

// ---------------------------------------------------------------------
// Dados do negócio e do contato
// ---------------------------------------------------------------------
const updateSchema = z.object({
  value: money,
  temperature: z.enum(["quente", "morno", "frio"]),
  sourceId: z.string(),
  ownerId: z.string(),
  customerType: z.enum(["B2C", "B2B"]),
  custom: z.record(z.string(), z.string().max(500)),
  name: z.string().trim().min(2, "Informe o nome do contato."),
  phone: z.string().trim(),
  email: z.string().trim().toLowerCase().refine((v) => !v || z.email().safeParse(v).success, "E-mail inválido."),
  org: z.string().trim().max(120),
});

export async function updateLead(slug: string, leadId: string, input: z.input<typeof updateSchema>): Promise<ActionResult> {
  const ctx = await context(slug);
  if (!ctx) return NO_ACCESS;
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  const d = parsed.data;
  const lead = await loadLead(ctx, leadId);
  if (!lead) return { ok: false, error: "Lead não encontrado." };
  if (!canEdit(ctx, lead)) return { ok: false, error: "Este lead é de outro vendedor. Pegue o lead antes de editar." };

  const phone = d.phone ? toE164(d.phone) : null;
  if (d.phone && !phone) return { ok: false, error: "Telefone inválido. Use DDD + número, ex.: (86) 99999-0000." };

  const custom = Object.fromEntries(Object.entries(d.custom).filter(([, v]) => v.trim() !== ""));
  const { error } = await ctx.supabase
    .from("leads")
    .update({
      value: d.value,
      temperature: d.temperature,
      source_id: d.sourceId || null,
      custom,
      // Só gestor/admin transfere (vendedor não passa lead para outro).
      ...(ctx.manager ? { owner_id: d.ownerId || null } : {}),
    })
    .eq("id", leadId);
  if (error) return { ok: false, error: "Não foi possível salvar o lead." };

  const { error: contactError } = await ctx.supabase
    .from("contacts")
    .update({ name: d.name, phone_e164: phone, email: d.email || null, org_name: d.org || null, customer_type: d.customerType })
    .eq("id", lead.contact_id);
  if (contactError) {
    return {
      ok: false,
      error: contactError.code === "23505" ? "Já existe outro contato com esse telefone nesta empresa." : "O lead foi salvo, mas o contato não.",
    };
  }

  refresh(slug);
  return { ok: true, message: "Lead atualizado." };
}

/** Vendedor pega um lead da fila (sem responsável). */
export async function takeLead(slug: string, leadId: string): Promise<ActionResult> {
  const ctx = await context(slug);
  if (!ctx) return NO_ACCESS;
  const { data, error } = await ctx.supabase
    .from("leads")
    .update({ owner_id: ctx.viewer.id })
    .eq("id", leadId)
    .eq("company_id", ctx.company.id)
    .is("owner_id", null)
    .select("id");
  if (error || !data?.length) return { ok: false, error: "Outra pessoa já pegou este lead." };
  refresh(slug);
  return { ok: true, message: "O lead agora é seu." };
}

export async function deleteLead(slug: string, leadId: string): Promise<ActionResult> {
  const ctx = await context(slug);
  if (!ctx) return NO_ACCESS;
  if (!ctx.manager) return { ok: false, error: "Só gestor ou administrador exclui leads." };
  const { data, error } = await ctx.supabase.from("leads").delete().eq("id", leadId).eq("company_id", ctx.company.id).select("id");
  if (error || !data?.length) return { ok: false, error: "Não foi possível excluir o lead." };
  refresh(slug);
  return { ok: true, message: "Lead excluído." };
}

// ---------------------------------------------------------------------
// Anotações e produtos de interesse
// ---------------------------------------------------------------------
export async function addNote(slug: string, leadId: string, body: string): Promise<ActionResult> {
  const ctx = await context(slug);
  if (!ctx) return NO_ACCESS;
  const text = body.trim();
  if (!text) return { ok: false, error: "Escreva a anotação." };
  const lead = await loadLead(ctx, leadId);
  if (!lead) return { ok: false, error: "Lead não encontrado." };
  if (!canEdit(ctx, lead)) return { ok: false, error: "Este lead é de outro vendedor." };

  const { error } = await ctx.supabase
    .from("activities")
    .insert({ company_id: ctx.company.id, lead_id: leadId, kind: "note", body: text.slice(0, 2000), user_id: ctx.viewer.id });
  if (error) return { ok: false, error: "Não foi possível salvar a anotação." };
  return { ok: true, message: "Anotação salva." };
}

const productsSchema = z
  .array(z.object({ productId: z.uuid(), mode: z.enum(["venda", "locacao"]), quantity: z.number().int().min(1).max(9999) }))
  .max(50);

export async function setLeadProducts(slug: string, leadId: string, items: z.input<typeof productsSchema>): Promise<ActionResult> {
  const ctx = await context(slug);
  if (!ctx) return NO_ACCESS;
  const parsed = productsSchema.safeParse(items);
  if (!parsed.success) return { ok: false, error: "Produtos inválidos." };
  const lead = await loadLead(ctx, leadId);
  if (!lead) return { ok: false, error: "Lead não encontrado." };
  if (!canEdit(ctx, lead)) return { ok: false, error: "Este lead é de outro vendedor." };

  const { error: delError } = await ctx.supabase.from("lead_products").delete().eq("lead_id", leadId);
  if (delError) return { ok: false, error: "Não foi possível atualizar os produtos." };
  if (parsed.data.length) {
    const rows = parsed.data.map((p) => ({ company_id: ctx.company.id, lead_id: leadId, product_id: p.productId, mode: p.mode, quantity: p.quantity }));
    const { error } = await ctx.supabase.from("lead_products").insert(rows);
    if (error) return { ok: false, error: "Não foi possível salvar os produtos." };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------
// Detalhe (histórico, tarefas, produtos)
// ---------------------------------------------------------------------
type ActivityRow = { id: string; kind: string; body: string; created_at: string; profiles: { full_name: string | null } | null };
type TaskRow = { id: string; title: string; due_at: string; done_at: string | null; origin: string; owner: { full_name: string | null } | null };
type LeadProductRow = {
  mode: "venda" | "locacao";
  quantity: number;
  products: { id: string; name: string; code: string | null; sale_price: string | number | null; rent_price_month: string | number | null; requires_human: boolean } | null;
};

export async function loadLeadDetail(slug: string, leadId: string): Promise<ActionResult<LeadDetail>> {
  const ctx = await context(slug);
  if (!ctx) return NO_ACCESS;

  const [acts, tasks, prods] = await Promise.all([
    ctx.supabase
      .from("activities")
      .select("id, kind, body, created_at, profiles(full_name)")
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false })
      .limit(100)
      .returns<ActivityRow[]>(),
    ctx.supabase
      .from("tasks")
      .select("id, title, due_at, done_at, origin, owner:profiles!tasks_owner_id_fkey(full_name)")
      .eq("lead_id", leadId)
      .order("due_at")
      .returns<TaskRow[]>(),
    ctx.supabase
      .from("lead_products")
      .select("mode, quantity, products(id, name, code, sale_price, rent_price_month, requires_human)")
      .eq("lead_id", leadId)
      .returns<LeadProductRow[]>(),
  ]);
  if (acts.error || tasks.error || prods.error) return { ok: false, error: "Não foi possível carregar o lead." };

  return {
    ok: true,
    data: {
      activities: (acts.data ?? []).map((a) => ({ id: a.id, kind: a.kind, body: a.body, userName: a.profiles?.full_name ?? null, createdAt: a.created_at })),
      tasks: (tasks.data ?? []).map((t) => ({ id: t.id, title: t.title, dueAt: t.due_at, doneAt: t.done_at, origin: t.origin, ownerName: t.owner?.full_name ?? null })),
      products: (prods.data ?? []).flatMap((p) =>
        p.products
          ? [
              {
                productId: p.products.id,
                name: p.products.name,
                code: p.products.code,
                mode: p.mode,
                quantity: p.quantity,
                price: (p.mode === "locacao" ? p.products.rent_price_month : p.products.sale_price) === null ? null : Number(p.mode === "locacao" ? p.products.rent_price_month : p.products.sale_price),
                requiresHuman: p.products.requires_human,
              },
            ]
          : [],
      ),
    },
  };
}
