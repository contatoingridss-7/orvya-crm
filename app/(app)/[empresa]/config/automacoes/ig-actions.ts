"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getViewer } from "@/lib/auth/viewer";
import { normalizeText } from "@/lib/instagram/inbound";
import { MENU_OPTION_MAX } from "@/lib/instagram/menu";
import { createClient } from "@/lib/supabase/server";

export type ActionResult = { ok: true; message: string } | { ok: false; error: string };

/** Respostas automáticas do Instagram: gestor e admin editam; o RLS confere de novo. */
async function managerContext(slug: string) {
  const viewer = await getViewer();
  if (!viewer?.active) return null;
  const company = viewer.companies.find((c) => c.slug === slug);
  // Admin, ou gestor com acesso às configurações (o RLS confere de novo: can_configure).
  if (!company || !company.canConfigure) return null;
  return { company, supabase: await createClient() };
}

const NOT_ALLOWED: ActionResult = { ok: false, error: "Só gestor ou administrador altera as respostas automáticas." };

const replySchema = z
  .object({
    trigger: z.enum(["welcome", "dm_keyword", "comment_keyword"]),
    keywords: z.string().max(500),
    reply: z.string().trim().min(1, "Escreva a resposta.").max(900, "Resposta de no máximo 900 caracteres."),
  })
  .transform((d) => ({
    ...d,
    // Vírgula separa as palavras; guardadas sem acento e em minúsculas.
    keywords: d.trigger === "welcome" ? [] : [...new Set(d.keywords.split(",").map(normalizeText).filter(Boolean))].slice(0, 20),
  }))
  .refine((d) => d.trigger === "welcome" || d.keywords.length > 0, { message: "Informe ao menos uma palavra-chave.", path: ["keywords"] });

function refresh(slug: string) {
  revalidatePath(`/${slug}/config/automacoes`);
}

export async function createIgReply(slug: string, input: z.input<typeof replySchema>): Promise<ActionResult> {
  const ctx = await managerContext(slug);
  if (!ctx) return NOT_ALLOWED;
  const parsed = replySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  const d = parsed.data;
  if (d.trigger === "welcome") {
    const { data: existing } = await ctx.supabase.from("ig_auto_replies").select("id").eq("company_id", ctx.company.id).eq("trigger", "welcome").limit(1);
    if (existing?.length) return { ok: false, error: "Já existe uma boas-vindas. Exclua a atual para trocar." };
  }
  const { error } = await ctx.supabase
    .from("ig_auto_replies")
    .insert({ company_id: ctx.company.id, trigger: d.trigger, keywords: d.keywords, reply: d.reply, position: 100 });
  if (error) return { ok: false, error: "Não foi possível salvar. Confira se a migration 0013 foi rodada." };
  refresh(slug);
  return { ok: true, message: "Resposta automática incluída." };
}

export async function toggleIgReply(slug: string, id: string, active: boolean): Promise<ActionResult> {
  const ctx = await managerContext(slug);
  if (!ctx) return NOT_ALLOWED;
  const { data, error } = await ctx.supabase.from("ig_auto_replies").update({ active }).eq("id", id).eq("company_id", ctx.company.id).select("id");
  if (error || !data?.length) return { ok: false, error: "Não foi possível alterar." };
  refresh(slug);
  return { ok: true, message: active ? "Resposta ligada." : "Resposta desligada." };
}

export async function deleteIgReply(slug: string, id: string): Promise<ActionResult> {
  const ctx = await managerContext(slug);
  if (!ctx) return NOT_ALLOWED;
  const { data, error } = await ctx.supabase.from("ig_auto_replies").delete().eq("id", id).eq("company_id", ctx.company.id).select("id");
  if (error || !data?.length) return { ok: false, error: "Não foi possível excluir." };
  refresh(slug);
  return { ok: true, message: "Resposta automática excluída." };
}

// ---------------------------------------------------------------------
// Menu de boas-vindas (opções que levam ao WhatsApp)
// ---------------------------------------------------------------------
const menuSchema = z.object({
  enabled: z.boolean(),
  intro: z.string().trim().min(1, "Escreva a mensagem de boas-vindas.").max(900),
  options: z
    .array(z.string().trim().max(MENU_OPTION_MAX, `Cada opção pode ter até ${MENU_OPTION_MAX} caracteres (limite do Instagram).`))
    .max(12)
    .transform((o) => o.filter(Boolean))
    .refine((o) => o.length >= 1, "Inclua ao menos uma opção (além de Outros)."),
  linkReply: z.string().trim().min(1, "Escreva a mensagem com o link.").max(900),
  whatsappNumberId: z.string(),
});

export async function saveIgMenu(slug: string, input: z.input<typeof menuSchema>): Promise<ActionResult> {
  const ctx = await managerContext(slug);
  if (!ctx) return NOT_ALLOWED;
  const parsed = menuSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  const d = parsed.data;
  if (d.whatsappNumberId) {
    const { data: n } = await ctx.supabase.from("whatsapp_numbers").select("id").eq("id", d.whatsappNumberId).eq("company_id", ctx.company.id).maybeSingle();
    if (!n) return { ok: false, error: "Número não encontrado." };
  }
  const { error } = await ctx.supabase.from("ig_welcome_menu").upsert(
    {
      company_id: ctx.company.id,
      enabled: d.enabled,
      intro: d.intro,
      options: d.options,
      link_reply: d.linkReply,
      whatsapp_number_id: d.whatsappNumberId || null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "company_id" },
  );
  if (error) return { ok: false, error: "Não foi possível salvar o menu. Confira se a migration 0013 foi rodada." };
  refresh(slug);
  return { ok: true, message: d.enabled ? "Menu de boas-vindas salvo e ligado." : "Menu de boas-vindas salvo (desligado)." };
}
