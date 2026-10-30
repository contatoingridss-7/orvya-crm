"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getViewer } from "@/lib/auth/viewer";
import { DAY_KEYS, parseHours } from "@/lib/whatsapp/after-hours";
import { createClient } from "@/lib/supabase/server";

export type ActionResult = { ok: true; message: string } | { ok: false; error: string };

const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Horário inválido (use HH:MM).");
const schema = z.object({
  enabled: z.boolean(),
  message: z.string().trim().min(1, "Escreva a mensagem.").max(900, "Mensagem de no máximo 900 caracteres."),
  days: z.array(z.object({ day: z.enum(DAY_KEYS), open: z.boolean(), start: HHMM, end: HHMM })).length(7),
});

/** Resposta fora do horário: admin, ou gestor com acesso às configurações (o RLS confere de novo: can_configure). */
export async function saveAfterHours(slug: string, input: z.input<typeof schema>): Promise<ActionResult> {
  const viewer = await getViewer();
  const company = viewer?.active ? viewer.companies.find((c) => c.slug === slug) : undefined;
  if (!company?.canConfigure) return { ok: false, error: "Só gestor com acesso às configurações ou administrador altera a resposta automática." };
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  const d = parsed.data;
  const bad = d.days.find((x) => x.open && x.start >= x.end);
  if (bad) return { ok: false, error: "Em cada dia aberto, o fechamento precisa ser depois da abertura." };
  const hours = parseHours(Object.fromEntries(d.days.filter((x) => x.open).map((x) => [x.day, [x.start, x.end]])));

  const supabase = await createClient();
  const { error } = await supabase
    .from("whatsapp_after_hours")
    .upsert({ company_id: company.id, enabled: d.enabled, hours, message: d.message, updated_at: new Date().toISOString() }, { onConflict: "company_id" });
  if (error) return { ok: false, error: "Não foi possível salvar. Confira se a migration 0019 foi rodada." };
  revalidatePath(`/${slug}/config/automacoes`);
  return { ok: true, message: d.enabled ? "Resposta fora do horário salva e ligada." : "Resposta fora do horário salva (desligada)." };
}
