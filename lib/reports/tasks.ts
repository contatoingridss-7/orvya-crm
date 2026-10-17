import type { SupabaseClient } from "@supabase/supabase-js";
import { resolvePeriod } from "@/lib/crm/period";

// Relatório de tarefas para gestão (tela Relatórios, PDF e e-mail de sábado).
// O mesmo cálculo serve ao cliente do usuário (RLS) e ao job semanal (service_role).

export type ReportPeriodKey = "7d" | "mes" | "mes-passado" | "30d";

export const REPORT_PERIODS: { key: ReportPeriodKey; label: string }[] = [
  { key: "7d", label: "Últimos 7 dias" },
  { key: "mes", label: "Este mês" },
  { key: "mes-passado", label: "Mês passado" },
  { key: "30d", label: "Últimos 30 dias" },
];

export type ReportPeriod = { key: ReportPeriodKey; label: string; start: Date; end: Date };

export function resolveReportPeriod(key: string | undefined, now = new Date()): ReportPeriod {
  if (key === "mes" || key === "mes-passado" || key === "30d") {
    const p = resolvePeriod(key, now);
    return { key, label: p.label, start: p.start, end: p.end };
  }
  return { key: "7d", label: "Últimos 7 dias", start: new Date(now.getTime() - 7 * 86_400_000), end: now };
}

export type ReportTask = {
  id: string;
  title: string;
  dueAt: string;
  doneAt: string | null;
  createdAt: string;
  origin: "manual" | "automation" | "system";
  ownerId: string | null;
  ownerName: string;
  leadName: string | null;
  pipelineName: string | null;
};

export type PersonStats = { id: string; name: string; done: number; onTime: number; overdueOpen: number; open: number };

export type TaskReport = {
  period: ReportPeriod;
  generatedAt: string;
  created: number;
  done: number;
  doneOnTime: number;
  /** % das concluídas no período que foram feitas até o prazo (null = nenhuma concluída). */
  onTimeRate: number | null;
  overdueOpen: number;
  nextSevenDays: number;
  byOrigin: { manual: number; automation: number; system: number };
  byPerson: PersonStats[];
  /** Atrasadas mais antigas (só na tela/PDF; o e-mail leva apenas números). */
  overdueList: ReportTask[];
};

type Row = {
  id: string;
  title: string;
  due_at: string;
  done_at: string | null;
  created_at: string;
  origin: ReportTask["origin"];
  owner_id: string | null;
  owner: { full_name: string | null; email: string | null } | null;
  leads: { contacts: { name: string } | null; pipelines: { name: string } | null } | null;
};

const SELECT =
  "id, title, due_at, done_at, created_at, origin, owner_id, owner:profiles!tasks_owner_id_fkey(full_name, email), leads(contacts(name), pipelines(name))";

/** Tarefas que importam para o período: criadas ou concluídas nele, e todas as abertas. */
export async function loadReportTasks(supabase: SupabaseClient, companyId: string, period: ReportPeriod): Promise<{ tasks: ReportTask[]; error: boolean }> {
  const start = period.start.toISOString();
  const { data, error } = await supabase
    .from("tasks")
    .select(SELECT)
    .eq("company_id", companyId)
    .or(`done_at.is.null,created_at.gte."${start}",done_at.gte."${start}"`)
    .order("due_at")
    .limit(5000)
    .returns<Row[]>();
  return {
    error: !!error,
    tasks: (data ?? []).map((r) => ({
      id: r.id,
      title: r.title,
      dueAt: r.due_at,
      doneAt: r.done_at,
      createdAt: r.created_at,
      origin: r.origin,
      ownerId: r.owner_id,
      ownerName: r.owner?.full_name || r.owner?.email || "Sem responsável",
      leadName: r.leads?.contacts?.name ?? null,
      pipelineName: r.leads?.pipelines?.name ?? null,
    })),
  };
}

export function buildTaskReport(tasks: ReportTask[], period: ReportPeriod, now = new Date()): TaskReport {
  const inP = (iso: string | null) => !!iso && new Date(iso) >= period.start && new Date(iso) < period.end;
  const nowMs = now.getTime();
  const weekAhead = nowMs + 7 * 86_400_000;

  const created = tasks.filter((t) => inP(t.createdAt));
  const done = tasks.filter((t) => inP(t.doneAt));
  const onTime = (t: ReportTask) => !!t.doneAt && new Date(t.doneAt).getTime() <= new Date(t.dueAt).getTime();
  const open = tasks.filter((t) => !t.doneAt);
  const overdue = open.filter((t) => new Date(t.dueAt).getTime() < nowMs);

  const people = new Map<string, PersonStats>();
  const person = (t: ReportTask) => {
    const key = t.ownerId ?? "sem";
    if (!people.has(key)) people.set(key, { id: key, name: t.ownerName, done: 0, onTime: 0, overdueOpen: 0, open: 0 });
    return people.get(key)!;
  };
  for (const t of done) {
    const p = person(t);
    p.done += 1;
    if (onTime(t)) p.onTime += 1;
  }
  for (const t of open) {
    const p = person(t);
    p.open += 1;
    if (new Date(t.dueAt).getTime() < nowMs) p.overdueOpen += 1;
  }

  const doneOnTime = done.filter(onTime).length;
  return {
    period,
    generatedAt: now.toISOString(),
    created: created.length,
    done: done.length,
    doneOnTime,
    onTimeRate: done.length ? Math.round((doneOnTime / done.length) * 100) : null,
    overdueOpen: overdue.length,
    nextSevenDays: open.filter((t) => {
      const d = new Date(t.dueAt).getTime();
      return d >= nowMs && d <= weekAhead;
    }).length,
    byOrigin: {
      manual: created.filter((t) => t.origin === "manual").length,
      automation: created.filter((t) => t.origin === "automation").length,
      system: created.filter((t) => t.origin === "system").length,
    },
    byPerson: [...people.values()].sort((a, b) => b.overdueOpen - a.overdueOpen || b.done - a.done || a.name.localeCompare(b.name, "pt-BR")),
    overdueList: overdue.slice(0, 15),
  };
}
