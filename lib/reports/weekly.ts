import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { sendEmail } from "@/lib/email/send";
import { publicEnv } from "@/lib/env";
import { renderTaskReportEmail } from "./email";
import { buildTaskReport, loadReportTasks, resolveReportPeriod } from "./tasks";

type Company = { id: string; slug: string; name: string };

/** Monta o e-mail dos últimos 7 dias de uma empresa (cliente do usuário ou service_role). */
export async function weeklyReportEmail(supabase: SupabaseClient, company: Company) {
  const period = resolveReportPeriod("7d");
  const [{ tasks, error }, delivered] = await Promise.all([
    loadReportTasks(supabase, company.id, period),
    supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("company_id", company.id)
      .gte("delivered_at", period.start.toISOString())
      .lt("delivered_at", period.end.toISOString()),
  ]);
  if (error) return null;
  return renderTaskReportEmail({
    companyName: company.name,
    report: buildTaskReport(tasks, period),
    deliveries: delivered.count ?? 0,
    link: `${publicEnv.NEXT_PUBLIC_APP_URL}/${company.slug}/relatorios?periodo=7d`,
  });
}

type MemberRow = { role: string; profiles: { email: string | null; active: boolean } | null };

/** Job de sábado: cada empresa recebe o próprio relatório; destinatários = gestores ativos + administradores. */
export async function sendWeeklyReports(admin: SupabaseClient) {
  const [companiesRes, adminsRes] = await Promise.all([
    admin.from("companies").select("id, slug, name").order("name").returns<Company[]>(),
    admin.from("profiles").select("email").eq("is_platform_admin", true).eq("active", true).returns<{ email: string | null }[]>(),
  ]);
  const admins = (adminsRes.data ?? []).flatMap((p) => (p.email ? [p.email] : []));
  const results: { empresa: string; enviado: boolean; destinatarios: number; erro?: string }[] = [];

  for (const company of companiesRes.data ?? []) {
    const { data: members } = await admin.from("memberships").select("role, profiles(email, active)").eq("company_id", company.id).returns<MemberRow[]>();
    const managers = (members ?? []).flatMap((m) => (m.role === "gestor" && m.profiles?.active && m.profiles.email ? [m.profiles.email] : []));
    const to = [...new Set([...managers, ...admins].map((e) => e.toLowerCase()))];

    const email = await weeklyReportEmail(admin, company);
    if (!email) {
      results.push({ empresa: company.slug, enviado: false, destinatarios: to.length, erro: "Falha ao ler as tarefas." });
      continue;
    }
    const sent = await sendEmail({ to, ...email });
    results.push({ empresa: company.slug, enviado: sent.ok, destinatarios: to.length, ...(sent.ok ? {} : { erro: sent.error }) });
  }
  return results;
}
