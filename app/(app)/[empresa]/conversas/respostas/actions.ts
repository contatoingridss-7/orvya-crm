"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isManager } from "@/lib/auth/roles";
import { getViewer } from "@/lib/auth/viewer";
import { createClient } from "@/lib/supabase/server";

export type ActionResult = { ok: true; message: string } | { ok: false; error: string };

/** Respostas rápidas e materiais: gestor e admin da empresa (o RLS confere de novo: is_company_manager). */
async function managerContext(slug: string) {
  const viewer = await getViewer();
  const company = viewer?.active ? viewer.companies.find((c) => c.slug === slug) : undefined;
  if (!company || !isManager(company.role)) return null;
  return { company, supabase: await createClient() };
}
const NOT_ALLOWED: ActionResult = { ok: false, error: "Só gestor ou administrador altera respostas e materiais." };

function refresh(slug: string) {
  revalidatePath(`/${slug}/conversas/respostas`);
  revalidatePath(`/${slug}/conversas`);
}

const replySchema = z.object({
  id: z.uuid().optional(),
  shortcut: z
    .string()
    .trim()
    .toLowerCase()
    .transform((v) =>
      v
        .replace(/^\//, "")
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/\s+/g, "-"),
    )
    .pipe(z.string().regex(/^[a-z0-9-]{2,30}$/, "Atalho de 2 a 30 letras, números ou hífen (ex.: horario).")),
  body: z.string().trim().min(1, "Escreva o texto.").max(2000, "Texto de no máximo 2.000 caracteres."),
});

export async function saveQuickReply(slug: string, input: z.input<typeof replySchema>): Promise<ActionResult> {
  const ctx = await managerContext(slug);
  if (!ctx) return NOT_ALLOWED;
  const parsed = replySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  const { id, shortcut, body } = parsed.data;
  const { error } = id
    ? await ctx.supabase.from("quick_replies").update({ shortcut, body }).eq("id", id).eq("company_id", ctx.company.id)
    : await ctx.supabase.from("quick_replies").insert({ company_id: ctx.company.id, shortcut, body });
  if (error) return { ok: false, error: error.code === "23505" ? `Já existe a resposta /${shortcut}.` : "Não foi possível salvar. A migration 0021 já foi rodada?" };
  refresh(slug);
  return { ok: true, message: id ? "Resposta atualizada." : `Resposta /${shortcut} criada.` };
}

export async function deleteQuickReply(slug: string, id: string): Promise<ActionResult> {
  const ctx = await managerContext(slug);
  if (!ctx) return NOT_ALLOWED;
  const { error } = await ctx.supabase.from("quick_replies").delete().eq("id", id).eq("company_id", ctx.company.id);
  if (error) return { ok: false, error: "Não foi possível excluir." };
  refresh(slug);
  return { ok: true, message: "Resposta excluída." };
}

const materialSchema = z.object({
  title: z.string().trim().min(1, "Dê um nome ao material.").max(120),
  filePath: z.string().regex(/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(pdf|jpg|jpeg|png|ogg)$/),
  fileName: z.string().trim().min(1).max(120),
  mime: z.enum(["application/pdf", "image/jpeg", "image/png", "audio/ogg"]),
  size: z.number().int().min(1).max(16 * 1024 * 1024),
});

/** Registra o material depois que o arquivo subiu para o bucket (pasta da empresa, conferida pelo RLS do storage). */
export async function addMaterial(slug: string, input: z.input<typeof materialSchema>): Promise<ActionResult> {
  const ctx = await managerContext(slug);
  if (!ctx) return NOT_ALLOWED;
  const parsed = materialSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Arquivo inválido." };
  const d = parsed.data;
  if (!d.filePath.startsWith(`${ctx.company.id}/`)) return { ok: false, error: "Arquivo fora da pasta da empresa." };
  const { error } = await ctx.supabase
    .from("sales_materials")
    .insert({ company_id: ctx.company.id, title: d.title, file_path: d.filePath, file_name: d.fileName, mime: d.mime, size_bytes: d.size });
  if (error) return { ok: false, error: "Não foi possível salvar o material." };
  refresh(slug);
  return { ok: true, message: "Material incluído. Já aparece em Anexar, nas conversas." };
}

export async function deleteMaterial(slug: string, id: string): Promise<ActionResult> {
  const ctx = await managerContext(slug);
  if (!ctx) return NOT_ALLOWED;
  const { data } = await ctx.supabase.from("sales_materials").select("file_path").eq("id", id).eq("company_id", ctx.company.id).maybeSingle<{ file_path: string }>();
  if (!data) return { ok: false, error: "Material não encontrado." };
  await ctx.supabase.storage.from("sales-materials").remove([data.file_path]);
  const { error } = await ctx.supabase.from("sales_materials").delete().eq("id", id);
  if (error) return { ok: false, error: "Não foi possível excluir." };
  refresh(slug);
  return { ok: true, message: "Material excluído." };
}
