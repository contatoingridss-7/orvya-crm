"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isManager } from "@/lib/auth/roles";
import { getViewer } from "@/lib/auth/viewer";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { connectedAccounts } from "@/lib/whatsapp/accounts";
import { createMetaTemplate, deleteMetaTemplate, GraphError, listMetaTemplates, type MetaTemplate } from "@/lib/whatsapp/graph";
import { cleanParam, countParams, friendlyToMeta, mapMetaStatus, normalizeTemplateName, type TemplateStatus } from "@/lib/whatsapp/templates";
import type { ActionResult } from "./actions";

const LANGUAGE = "pt_BR";
const NOT_ALLOWED: ActionResult = { ok: false, error: "Só o administrador cria e exclui modelos de mensagem." };

/** Criar e excluir modelos: só o administrador da plataforma (RLS de message_templates). */
async function adminContext(slug: string) {
  const viewer = await getViewer();
  if (!viewer?.active || !viewer.isAdmin) return null;
  const company = viewer.companies.find((c) => c.slug === slug);
  return company ? { company, supabase: await createClient() } : null;
}

function refresh(slug: string) {
  revalidatePath(`/${slug}/config/canais`);
  revalidatePath(`/${slug}/conversas`);
}

function metaError(e: unknown, action: string): string {
  if (e instanceof GraphError) {
    if (e.code === 190) return "O token de acesso do número expirou. Reconecte o número com um token permanente.";
    if (e.code === 10 || e.code === 200 || e.code === 294)
      return "O token do número não tem permissão para gerenciar modelos (whatsapp_business_management).";
    return `A Meta recusou ${action}: ${e.message}`;
  }
  return "Não foi possível falar com a Meta. Tente de novo em instantes.";
}

const createSchema = z.object({
  name: z.string().trim().min(1, "Dê um nome ao modelo.").max(200),
  category: z.enum(["MARKETING", "UTILITY"], { error: "Escolha a categoria." }),
  bodyFriendly: z.string().trim().min(1, "Escreva o texto do modelo.").max(1024, "Texto longo demais (máximo de 1.024 caracteres)."),
  examples: z.array(z.string().max(200)).max(20),
});

/**
 * Novo modelo: converte {{nome}}, {{produto}}... para {{1}}, {{2}}... e manda para a análise da Meta
 * em cada conta (WABA) conectada da empresa. Sem número conectado, fica como rascunho.
 */
export async function createTemplate(slug: string, input: z.input<typeof createSchema>): Promise<ActionResult> {
  const ctx = await adminContext(slug);
  if (!ctx) return NOT_ALLOWED;
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  const d = parsed.data;

  const name = normalizeTemplateName(d.name);
  if (!name) return { ok: false, error: "Nome inválido. Use letras, números e _ (ex.: retomar_orcamento)." };
  const { body, variables } = friendlyToMeta(d.bodyFriendly);
  if (/^\{\{\d+\}\}/.test(body) || /\{\{\d+\}\}\s*$/.test(body)) {
    return { ok: false, error: "Pela regra da Meta, o texto não pode começar nem terminar com um campo entre chaves." };
  }
  const examples = d.examples.map(cleanParam);
  if (examples.length !== variables.length || examples.some((v) => !v)) {
    return { ok: false, error: "Preencha um exemplo para cada campo entre chaves. A Meta usa os exemplos na análise." };
  }

  const { data: existing } = await ctx.supabase
    .from("message_templates")
    .select("id, status")
    .eq("company_id", ctx.company.id)
    .eq("name", name)
    .eq("language", LANGUAGE)
    .maybeSingle<{ id: string; status: TemplateStatus }>();
  if (existing && existing.status !== "draft") return { ok: false, error: `Já existe um modelo chamado “${name}”. Use outro nome.` };

  const accounts = await connectedAccounts(createAdminClient(), ctx.company.id);
  let status: TemplateStatus = "draft";
  let metaId: string | null = null;
  const failures: string[] = [];
  for (const acc of accounts) {
    try {
      const res = await createMetaTemplate(acc.wabaId, acc.token, { name, language: LANGUAGE, category: d.category, body, examples });
      metaId ??= res.id;
      status = mapMetaStatus(res.status) ?? "pending";
    } catch (e) {
      failures.push(metaError(e, "o modelo"));
    }
  }
  if (accounts.length > 0 && !metaId) return { ok: false, error: failures[0] ?? "A Meta não aceitou o modelo." };

  const row = { company_id: ctx.company.id, name, language: LANGUAGE, category: d.category, status, body, variables, meta_template_id: metaId, rejected_reason: null };
  const { error } = existing
    ? await ctx.supabase.from("message_templates").update(row).eq("id", existing.id)
    : await ctx.supabase.from("message_templates").insert(row);
  if (error) {
    return {
      ok: false,
      error: metaId
        ? "O modelo foi para a Meta, mas não ficou salvo no Orvya. Use “Atualizar status” para trazê-lo."
        : "Não foi possível salvar o modelo.",
    };
  }

  refresh(slug);
  if (!accounts.length) {
    return { ok: true, message: "Modelo salvo como rascunho. Conecte um número da empresa e envie para aprovação." };
  }
  const partial = failures.length ? ` Atenção: uma das contas recusou (${failures[0]}).` : "";
  return {
    ok: true,
    message:
      status === "approved"
        ? `Modelo “${name}” aprovado pela Meta.${partial}`
        : `Modelo “${name}” enviado para a análise da Meta. Costuma levar de minutos a algumas horas.${partial}`,
  };
}

const RANK: Record<TemplateStatus, number> = { approved: 5, pending: 4, paused: 3, rejected: 2, disabled: 1, draft: 0 };
type LocalRow = { id: string; name: string; language: string; status: TemplateStatus; meta_template_id: string | null };

/**
 * Atualiza status, categoria e motivo de rejeição a partir da Meta e importa os modelos
 * criados direto no Gerenciador do WhatsApp. Gestor ou administrador.
 */
export async function syncTemplates(slug: string): Promise<ActionResult> {
  const viewer = await getViewer();
  if (!viewer?.active) return { ok: false, error: "Sem acesso a esta empresa." };
  const company = viewer.companies.find((c) => c.slug === slug);
  if (!company) return { ok: false, error: "Sem acesso a esta empresa." };
  if (!isManager(company.role)) return { ok: false, error: "Só gestor ou administrador atualiza os modelos." };

  // Escrita com service_role: o RLS só deixa o administrador escrever, e o gestor também pode sincronizar.
  const admin = createAdminClient();
  const accounts = await connectedAccounts(admin, company.id);
  if (!accounts.length) return { ok: false, error: "Nenhum número conectado. Conecte um número para consultar os modelos na Meta." };

  const remote = new Map<string, MetaTemplate & { mapped: TemplateStatus }>();
  const failures: string[] = [];
  for (const acc of accounts) {
    try {
      for (const t of await listMetaTemplates(acc.wabaId, acc.token)) {
        const mapped = mapMetaStatus(t.status);
        if (!mapped || !t.name) continue;
        const key = `${t.name}|${t.language ?? LANGUAGE}`;
        const prev = remote.get(key);
        // Mesmo modelo em duas contas: vale o melhor status (aprovado em uma já permite enviar por ela).
        if (!prev || RANK[mapped] > RANK[prev.mapped]) remote.set(key, { ...t, mapped });
      }
    } catch (e) {
      failures.push(metaError(e, "a consulta"));
    }
  }
  if (failures.length === accounts.length) return { ok: false, error: failures[0]! };

  const { data: localRows } = await admin
    .from("message_templates")
    .select("id, name, language, status, meta_template_id")
    .eq("company_id", company.id)
    .returns<LocalRow[]>();
  const local = new Map((localRows ?? []).map((r) => [`${r.name}|${r.language}`, r]));

  let updated = 0;
  let imported = 0;
  for (const [key, t] of remote) {
    const category = (["MARKETING", "UTILITY", "AUTHENTICATION"] as const).find((c) => c === t.category?.toUpperCase());
    const rejected = t.mapped === "rejected" && t.rejected_reason && t.rejected_reason !== "NONE" ? t.rejected_reason : null;
    const row = local.get(key);
    if (row) {
      const { error } = await admin
        .from("message_templates")
        .update({
          status: t.mapped,
          rejected_reason: rejected,
          meta_template_id: row.meta_template_id ?? t.id,
          ...(category ? { category } : {}),
        })
        .eq("id", row.id);
      if (!error) updated++;
    } else if (/^[a-z0-9_]+$/.test(t.name)) {
      const body = t.components?.find((c) => c.type?.toUpperCase() === "BODY")?.text ?? "";
      const n = countParams(body);
      const { error } = await admin.from("message_templates").insert({
        company_id: company.id,
        name: t.name,
        language: t.language ?? LANGUAGE,
        category: category ?? "UTILITY",
        status: t.mapped,
        body: body || "(modelo sem texto no corpo)",
        variables: Array.from({ length: n }, (_, i) => `var${i + 1}`),
        meta_template_id: t.id,
        rejected_reason: rejected,
      });
      if (!error) imported++;
    }
  }

  refresh(slug);
  const parts = [`${updated} ${updated === 1 ? "modelo atualizado" : "modelos atualizados"}`];
  if (imported) parts.push(`${imported} ${imported === 1 ? "importado" : "importados"} da Meta`);
  const warn = failures.length ? ` Uma das contas não respondeu (${failures[0]}).` : "";
  return { ok: true, message: `Status atualizado: ${parts.join(", ")}.${warn}` };
}

/** Exclui no Orvya e tenta excluir na Meta. Só administrador. */
export async function deleteTemplate(slug: string, id: string): Promise<ActionResult> {
  const ctx = await adminContext(slug);
  if (!ctx) return NOT_ALLOWED;
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "Modelo inválido." };

  const { data: tpl } = await ctx.supabase
    .from("message_templates")
    .select("id, name, status, meta_template_id")
    .eq("id", id)
    .eq("company_id", ctx.company.id)
    .maybeSingle<{ id: string; name: string; status: TemplateStatus; meta_template_id: string | null }>();
  if (!tpl) return { ok: false, error: "Modelo não encontrado." };

  let metaWarning = "";
  if (tpl.status !== "draft") {
    const accounts = await connectedAccounts(createAdminClient(), ctx.company.id);
    for (const acc of accounts) {
      try {
        await deleteMetaTemplate(acc.wabaId, acc.token, tpl.name);
      } catch (e) {
        metaWarning = ` Não foi possível excluir na Meta (${metaError(e, "a exclusão")}). Exclua também no Gerenciador do WhatsApp.`;
      }
    }
  }

  const { error } = await ctx.supabase.from("message_templates").delete().eq("id", tpl.id);
  if (error) return { ok: false, error: "Não foi possível excluir o modelo." };
  refresh(slug);
  return { ok: true, message: `Modelo “${tpl.name}” excluído.${metaWarning}` };
}
