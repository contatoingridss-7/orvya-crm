"use server";

import { isManager } from "@/lib/auth/roles";
import { getViewer } from "@/lib/auth/viewer";
import { emailConfigured, sendEmail } from "@/lib/email/send";
import { weeklyReportEmail } from "@/lib/reports/weekly";
import { createClient } from "@/lib/supabase/server";

export type ActionResult = { ok: true; message: string } | { ok: false; error: string };

/** Envia o e-mail de sábado agora, só para quem pediu (para conferir antes do envio automático). */
export async function sendTestReport(slug: string): Promise<ActionResult> {
  const viewer = await getViewer();
  const company = viewer?.active ? viewer.companies.find((c) => c.slug === slug) : null;
  if (!viewer || !company || !isManager(company.role)) return { ok: false, error: "Só gestor ou administrador recebe o relatório." };
  if (!emailConfigured()) return { ok: false, error: "O envio de e-mail ainda não foi configurado (Resend)." };

  const email = await weeklyReportEmail(await createClient(), company);
  if (!email) return { ok: false, error: "Não foi possível montar o relatório." };
  const sent = await sendEmail({ to: [viewer.email], ...email });
  return sent.ok ? { ok: true, message: `Relatório enviado para ${viewer.email}.` } : { ok: false, error: sent.error };
}
