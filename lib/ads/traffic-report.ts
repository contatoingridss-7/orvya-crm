import { formatInTimeZone } from "date-fns-tz";
import type { SupabaseClient } from "@supabase/supabase-js";
import { formatBRL, formatDate, TIMEZONE } from "@/lib/format";
import { loadGoals, loadIndicators, previousRange } from "./indicators";
import type { InsightLevel } from "./insights";

// Relatórios de tráfego para o cliente: diário (ontem) e semanal (segunda a domingo).
// O rascunho guarda uma fotografia dos números; a gestora escreve as observações, tira o que
// não quer mostrar e libera. O cliente abre pelo link, sem login. Só métricas de anúncio e de
// atendimento: nada de conversa, nome de paciente ou dado de saúde.

export type ReportKind = "diario" | "semanal";

export type ReportData = {
  version: 1;
  companyName: string;
  since: string;
  until: string;
  previous: { since: string; until: string };
  metrics: { key: string; label: string; value: string; raw: number | null; change: number | null; better: "up" | "down" }[];
  alerts: { id: string; level: InsightLevel; text: string }[];
  creatives: { name: string; thumbnailUrl: string | null; spend: number; conversations: number; costPerConversation: number | null; sales: number }[];
  funnel: { label: string; value: number }[];
  firstResponseMin: number | null;
  generatedAt: string;
};

export type ReportRow = {
  id: string;
  company_id: string;
  kind: ReportKind;
  period_start: string;
  period_end: string;
  status: "rascunho" | "liberado";
  data: ReportData;
  notes_done: string | null;
  notes_next: string | null;
  hidden_alerts: string[];
  share_token: string;
  created_at: string;
  released_at: string | null;
};

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Diário = ontem. Semanal = segunda a domingo da semana passada. */
export function reportRange(kind: ReportKind, now = new Date()) {
  const today = formatInTimeZone(now, TIMEZONE, "yyyy-MM-dd");
  if (kind === "diario") {
    const y = addDays(today, -1);
    return { since: y, until: y };
  }
  const dow = Number(formatInTimeZone(now, TIMEZONE, "i")); // 1 = segunda
  const thisMonday = addDays(today, -(dow - 1));
  return { since: addDays(thisMonday, -7), until: addDays(thisMonday, -1) };
}

const int = new Intl.NumberFormat("pt-BR");
const dateBR = (iso: string) => formatDate(`${iso}T12:00:00`);
export const reportPeriodText = (since: string, until: string) => (since === until ? dateBR(since) : `${dateBR(since)} a ${dateBR(until)}`);

/** Calcula os números do período e monta a fotografia do relatório. */
export async function buildReportData(supabase: SupabaseClient, company: { id: string; name: string }, since: string, until: string): Promise<ReportData> {
  const { goals, saved } = await loadGoals(supabase, company.id);
  const ind = await loadIndicators(supabase, [company.id], { since, until }, { goals, goalsSaved: saved });
  const m = ind.metrics;
  const metrics: ReportData["metrics"] = [
    { key: "spend", label: "Investimento", value: formatBRL(m.spend.value ?? 0), raw: m.spend.value, change: m.spend.change, better: "up" },
    { key: "conversations", label: "Conversas iniciadas", value: int.format(m.conversations.value ?? 0), raw: m.conversations.value, change: m.conversations.change, better: "up" },
    {
      key: "costPerConversation",
      label: "Custo por conversa",
      value: m.costPerConversation.value === null ? "—" : formatBRL(m.costPerConversation.value),
      raw: m.costPerConversation.value,
      change: m.costPerConversation.change,
      better: "down",
    },
    { key: "leads", label: "Contatos no atendimento", value: int.format(m.leads.value ?? 0), raw: m.leads.value, change: m.leads.change, better: "up" },
    { key: "sales", label: "Vendas", value: int.format(m.sales.value ?? 0), raw: m.sales.value, change: m.sales.change, better: "up" },
    { key: "revenue", label: "Faturamento das vendas", value: formatBRL(m.revenue.value ?? 0), raw: m.revenue.value, change: m.revenue.change, better: "up" },
  ];
  const alerts = ind.insights.filter((i) => i.client).map((i) => ({ id: i.id, level: i.level, text: i.client! }));
  const creatives = ind.creatives
    .filter((c) => c.verdict !== "sem-dados" && c.conversations > 0)
    .sort((a, b) => b.conversations - a.conversations)
    .slice(0, 3)
    .map((c) => ({ name: c.name, thumbnailUrl: c.thumbnailUrl, spend: c.spend, conversations: c.conversations, costPerConversation: c.costPerConversation, sales: c.sales }));
  return {
    version: 1,
    companyName: company.name,
    since,
    until,
    previous: previousRange(since, until),
    metrics,
    alerts,
    creatives,
    funnel: [
      { label: "Pessoas alcançadas (exibições)", value: ind.funnel.impressions },
      { label: "Cliques no anúncio", value: ind.funnel.clicks },
      { label: "Conversas iniciadas", value: ind.funnel.conversations },
      { label: "Contatos no atendimento", value: ind.funnel.leads },
      { label: "Vendas", value: ind.funnel.sales },
    ],
    firstResponseMin: ind.ops.adLeads >= 3 ? ind.ops.medianFirstResponseMin : null,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Cria (ou atualiza, se ainda for rascunho) o relatório do período. Relatório já liberado não
 * é tocado: o cliente pode já ter aberto.
 */
export async function upsertDraft(
  supabase: SupabaseClient,
  company: { id: string; name: string },
  kind: ReportKind,
  range: { since: string; until: string },
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const { data: existing } = await supabase
    .from("traffic_reports")
    .select("id, status")
    .eq("company_id", company.id)
    .eq("kind", kind)
    .eq("period_start", range.since)
    .eq("period_end", range.until)
    .maybeSingle<{ id: string; status: string }>();
  if (existing?.status === "liberado") return { ok: true, id: existing.id };

  const data = await buildReportData(supabase, company, range.since, range.until);
  if (existing) {
    const { error } = await supabase.from("traffic_reports").update({ data }).eq("id", existing.id);
    return error ? { ok: false, error: "Não foi possível atualizar o rascunho." } : { ok: true, id: existing.id };
  }
  const { data: row, error } = await supabase
    .from("traffic_reports")
    .insert({ company_id: company.id, kind, period_start: range.since, period_end: range.until, data })
    .select("id")
    .single<{ id: string }>();
  return error || !row ? { ok: false, error: "Não foi possível criar o relatório. A migration 0018 já foi rodada?" } : { ok: true, id: row.id };
}

/** Rotina da manhã: rascunho diário de ontem e, na segunda, o semanal. Só empresas com conta de anúncio ativa. */
export async function createScheduledDrafts(admin: SupabaseClient, now = new Date()) {
  const { data: accounts } = await admin.from("ad_accounts").select("company_id, companies(name)").eq("active", true).returns<{ company_id: string; companies: { name: string } | null }[]>();
  const companies = new Map((accounts ?? []).map((a) => [a.company_id, a.companies?.name ?? ""]));
  const monday = formatInTimeZone(now, TIMEZONE, "i") === "1";
  const out: { empresa: string; tipo: ReportKind; ok: boolean }[] = [];
  for (const [id, name] of companies) {
    const kinds: ReportKind[] = monday ? ["diario", "semanal"] : ["diario"];
    for (const kind of kinds) {
      const r = await upsertDraft(admin, { id, name }, kind, reportRange(kind, now)).catch(() => ({ ok: false as const, error: "" }));
      out.push({ empresa: name, tipo: kind, ok: r.ok });
    }
  }
  return out;
}

/** Variação contra a semana anterior, só quando passa de 5%. */
const arrow = (change: number | null) => (change === null || Math.abs(change) < 0.05 ? "" : ` (${change > 0 ? "▲" : "▼"} ${Math.round(Math.abs(change) * 100)}%)`);

/** Texto pronto para colar no WhatsApp do cliente (negrito com *). */
export function whatsappText(report: Pick<ReportRow, "kind" | "data" | "notes_done" | "notes_next" | "hidden_alerts">, url: string) {
  const d = report.data;
  const daily = report.kind === "diario";
  const pick = (key: string) => d.metrics.find((x) => x.key === key);
  const lines: string[] = [];
  lines.push(`*${daily ? "Resumo do dia" : "Relatório da semana"} · ${d.companyName}*`);
  lines.push(reportPeriodText(d.since, d.until));
  lines.push("");
  const keys = daily ? ["spend", "conversations", "costPerConversation", "sales"] : ["spend", "conversations", "costPerConversation", "leads", "sales", "revenue"];
  for (const k of keys) {
    const x = pick(k);
    if (x) lines.push(`• ${x.label}: *${x.value}*${daily ? "" : arrow(x.change)}`);
  }
  const alerts = d.alerts.filter((a) => !report.hidden_alerts.includes(a.id));
  if (alerts.length) {
    lines.push("");
    for (const a of alerts.slice(0, daily ? 2 : 4)) lines.push(`${a.level === "bom" ? "✓" : "•"} ${a.text}`);
  }
  if (report.notes_done?.trim()) {
    lines.push("");
    lines.push(daily ? report.notes_done.trim() : `*O que fizemos:* ${report.notes_done.trim()}`);
  }
  if (report.notes_next?.trim()) {
    lines.push(daily ? report.notes_next.trim() : `*Próximos passos:* ${report.notes_next.trim()}`);
  }
  lines.push("");
  lines.push(`${daily ? "Detalhes" : "Relatório completo"}: ${url}`);
  return lines.join("\n");
}
