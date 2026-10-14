"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isManager } from "@/lib/auth/roles";
import { getViewer } from "@/lib/auth/viewer";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { spacedSchedule } from "@/lib/whatsapp/queue";
import { cleanParam, countParams } from "@/lib/whatsapp/templates";

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

const NO_ACCESS = { ok: false as const, error: "Só gestor e administrador podem fazer isso nesta empresa." };

/** Só gestor/admin da empresa (SPEC, matriz: reativação em lote e assumir para outro vendedor). */
async function managerContext(slug: string) {
  const viewer = await getViewer();
  if (!viewer?.active) return null;
  const company = viewer.companies.find((c) => c.slug === slug);
  if (!company || !isManager(company.role)) return null;
  return { viewer, company, supabase: await createClient() };
}

function revalidate(slug: string) {
  revalidatePath(`/${slug}/fila`);
  revalidatePath(`/${slug}/conversas`);
}

const assumeSchema = z.object({ conversationId: z.uuid(), userId: z.uuid("Escolha quem vai atender.") });

/**
 * Assumir pela tela "Precisa de mim": o gestor escolhe quem atende (padrão: ele mesmo).
 * A IA pausa, o pedido de atendimento sai da fila e o lead ganha responsável se não tinha.
 * Tudo pelo cliente autenticado: o RLS garante que é gestor/admin da empresa.
 */
export async function assignConversation(slug: string, input: z.input<typeof assumeSchema>): Promise<ActionResult> {
  const ctx = await managerContext(slug);
  if (!ctx) return NO_ACCESS;
  const parsed = assumeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  const { conversationId, userId } = parsed.data;

  if (userId !== ctx.viewer.id) {
    const { data: member } = await ctx.supabase
      .from("memberships")
      .select("user_id, profiles(active)")
      .eq("company_id", ctx.company.id)
      .eq("user_id", userId)
      .maybeSingle<{ user_id: string; profiles: { active: boolean } | null }>();
    if (!member || member.profiles?.active === false) return { ok: false, error: "Essa pessoa não faz parte da equipe desta empresa." };
  }

  const { data: conv } = await ctx.supabase
    .from("conversations")
    .update({ assigned_to: userId, needs_human: false, ai_enabled: false })
    .eq("id", conversationId)
    .eq("company_id", ctx.company.id)
    .select("id, lead_id")
    .maybeSingle<{ id: string; lead_id: string | null }>();
  if (!conv) return { ok: false, error: "Conversa não encontrada." };

  if (conv.lead_id) {
    await ctx.supabase.from("leads").update({ owner_id: userId }).eq("id", conv.lead_id).is("owner_id", null);
  }

  revalidate(slug);
  return { ok: true, message: userId === ctx.viewer.id ? "Você assumiu a conversa." : "Conversa passada para o vendedor." };
}

const MAX_BATCH = 100;

const reactivateSchema = z.object({
  templateId: z.uuid("Escolha o modelo."),
  items: z
    .array(
      z.object({
        leadId: z.uuid(),
        conversationId: z.uuid(),
        values: z.array(z.string().max(200, "Campo longo demais.")).max(20),
      }),
    )
    .min(1, "Selecione pelo menos um lead.")
    .max(MAX_BATCH, `Envie no máximo ${MAX_BATCH} leads por vez.`),
});

type LeadCheck = { id: string; contact_id: string; closed_at: string | null };
type ConvCheck = { id: string; contact_id: string; whatsapp_numbers: { status: string } | null };

/**
 * Reativação em lote (SPEC 4.6): valida pelo cliente autenticado (RLS) que o gestor vê os leads,
 * as conversas e o modelo aprovado; depois grava a fila com o cliente admin, com 2 a 6 minutos
 * entre as mensagens. Quem envia de fato é a rota /api/jobs/fila-envio.
 */
export async function reactivateLeads(slug: string, input: z.input<typeof reactivateSchema>): Promise<ActionResult> {
  const ctx = await managerContext(slug);
  if (!ctx) return NO_ACCESS;
  const parsed = reactivateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  const { templateId, items } = parsed.data;

  const leadIds = [...new Set(items.map((i) => i.leadId))];
  if (leadIds.length !== items.length) return { ok: false, error: "Há leads repetidos na seleção." };
  const convIds = [...new Set(items.map((i) => i.conversationId))];

  const [tplRes, leadsRes, convRes, pendingRes] = await Promise.all([
    ctx.supabase
      .from("message_templates")
      .select("id, body, status")
      .eq("id", templateId)
      .eq("company_id", ctx.company.id)
      .maybeSingle<{ id: string; body: string; status: string }>(),
    ctx.supabase.from("leads").select("id, contact_id, closed_at").eq("company_id", ctx.company.id).in("id", leadIds).returns<LeadCheck[]>(),
    ctx.supabase
      .from("conversations")
      .select("id, contact_id, whatsapp_numbers(status)")
      .eq("company_id", ctx.company.id)
      .eq("channel", "whatsapp")
      .in("id", convIds)
      .returns<ConvCheck[]>(),
    ctx.supabase
      .from("outbound_queue")
      .select("lead_id, scheduled_at")
      .eq("company_id", ctx.company.id)
      .eq("status", "pendente")
      .order("scheduled_at", { ascending: false })
      .returns<{ lead_id: string | null; scheduled_at: string }[]>(),
  ]);
  if (leadsRes.error || convRes.error || pendingRes.error) return { ok: false, error: "Não foi possível conferir os leads. Tente de novo." };

  const tpl = tplRes.data;
  if (!tpl) return { ok: false, error: "Modelo não encontrado." };
  if (tpl.status !== "approved") return { ok: false, error: "Este modelo não está aprovado pela Meta." };
  const nParams = countParams(tpl.body);

  const leads = new Map((leadsRes.data ?? []).map((l) => [l.id, l]));
  const convs = new Map((convRes.data ?? []).map((c) => [c.id, c]));
  const alreadyQueued = new Set((pendingRes.data ?? []).map((p) => p.lead_id));

  const rows: { leadId: string; conversationId: string; params: string[] }[] = [];
  let skipped = 0;
  for (const it of items) {
    const lead = leads.get(it.leadId);
    const conv = convs.get(it.conversationId);
    if (!lead || !conv) return { ok: false, error: "Algum lead ou conversa não está mais disponível. Recarregue a página." };
    if (lead.closed_at) return { ok: false, error: "Algum lead selecionado já foi fechado. Recarregue a página." };
    if (conv.contact_id !== lead.contact_id) return { ok: false, error: "A conversa não pertence ao lead. Recarregue a página." };
    if (conv.whatsapp_numbers?.status !== "connected") return { ok: false, error: "O número de WhatsApp de algum lead não está conectado." };
    const params = it.values.map(cleanParam);
    if (params.length !== nParams || params.some((v) => !v)) return { ok: false, error: "Preencha todos os campos do modelo para os leads selecionados." };
    if (alreadyQueued.has(lead.id)) {
      skipped++;
      continue;
    }
    rows.push({ leadId: lead.id, conversationId: conv.id, params });
  }
  if (!rows.length) return { ok: false, error: "Todos os leads selecionados já estão na fila de envio." };

  // Continua depois do último envio já agendado da empresa, para manter o intervalo entre lotes.
  const last = pendingRes.data?.[0]?.scheduled_at;
  const times = spacedSchedule(rows.length, last ? new Date(last) : null);

  const { error } = await createAdminClient()
    .from("outbound_queue")
    .insert(
      rows.map((r, i) => ({
        company_id: ctx.company.id,
        conversation_id: r.conversationId,
        lead_id: r.leadId,
        template_id: tpl.id,
        params: r.params,
        scheduled_at: times[i]!.toISOString(),
        created_by: ctx.viewer.id,
      })),
    );
  if (error) return { ok: false, error: "Não foi possível agendar os envios. Tente de novo." };

  revalidate(slug);
  const n = rows.length;
  return {
    ok: true,
    message: `${n} ${n === 1 ? "envio agendado" : "envios agendados"}.${skipped ? ` ${skipped} já estava${skipped === 1 ? "" : "m"} na fila.` : ""}`,
  };
}

/** Cancela os envios pendentes da empresa. O RLS só deixa gestor/admin mudar 'pendente' → 'cancelado'. */
export async function cancelPendingQueue(slug: string): Promise<ActionResult> {
  const ctx = await managerContext(slug);
  if (!ctx) return NO_ACCESS;
  const { data, error } = await ctx.supabase
    .from("outbound_queue")
    .update({ status: "cancelado" })
    .eq("company_id", ctx.company.id)
    .eq("status", "pendente")
    .select("id");
  if (error) return { ok: false, error: "Não foi possível cancelar. Tente de novo." };
  revalidate(slug);
  const n = data?.length ?? 0;
  return { ok: true, message: n ? `${n} ${n === 1 ? "envio cancelado" : "envios cancelados"}.` : "Não havia envios pendentes." };
}
