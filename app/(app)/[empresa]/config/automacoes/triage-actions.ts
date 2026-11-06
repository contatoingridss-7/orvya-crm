"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getViewer } from "@/lib/auth/viewer";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "./distribution-actions";

const schema = z.object({
  enabled: z.boolean(),
  intro: z.string().trim().min(1, "Escreva a mensagem.").max(1024),
  options: z
    .array(z.object({ title: z.string().trim().min(1, "Dê um nome a cada botão.").max(20, "Cada botão pode ter até 20 caracteres."), pipelineId: z.uuid("Escolha o funil de cada botão.") }))
    .min(1, "Inclua pelo menos um botão.")
    .max(3, "O WhatsApp aceita até 3 botões."),
});

/** Triagem do WhatsApp: gestor com acesso às configurações ou admin (o RLS confere de novo). */
export async function saveTriage(slug: string, input: z.input<typeof schema>): Promise<ActionResult> {
  const viewer = await getViewer();
  const company = viewer?.active ? viewer.companies.find((c) => c.slug === slug) : undefined;
  if (!company?.canConfigure) return { ok: false, error: "Só gestor com acesso às configurações ou administrador altera a triagem." };
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  const d = parsed.data;

  const supabase = await createClient();
  const { count } = await supabase.from("pipelines").select("id", { count: "exact", head: true }).eq("company_id", company.id).in("id", d.options.map((o) => o.pipelineId));
  if ((count ?? 0) !== new Set(d.options.map((o) => o.pipelineId)).size) return { ok: false, error: "Funil inválido." };
  const { error } = await supabase.from("whatsapp_triage").upsert(
    {
      company_id: company.id,
      enabled: d.enabled,
      intro: d.intro,
      options: d.options.map((o) => ({ title: o.title, pipeline_id: o.pipelineId })),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "company_id" },
  );
  if (error) return { ok: false, error: "Não foi possível salvar. Confira se a migration 0030 foi rodada." };
  revalidatePath(`/${slug}/config/automacoes`);
  return { ok: true, message: d.enabled ? "Triagem salva e ligada." : "Triagem salva (desligada)." };
}
