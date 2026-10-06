import { formatInTimeZone } from "date-fns-tz";
import { TIMEZONE } from "@/lib/format";

export type TaskItem = {
  id: string;
  title: string;
  dueAt: string;
  doneAt: string | null;
  origin: "manual" | "automation" | "system";
  ownerId: string | null;
  ownerName: string | null;
  createdBy: string | null;
  leadId: string | null;
  leadName: string | null;
  pipelineKey: string | null;
};

export const TASK_SELECT =
  "id, title, due_at, done_at, origin, owner_id, created_by, lead_id, owner:profiles!tasks_owner_id_fkey(full_name), leads(id, contacts(name), pipelines(key))";

export type TaskRow = {
  id: string;
  title: string;
  due_at: string;
  done_at: string | null;
  origin: TaskItem["origin"];
  owner_id: string | null;
  created_by: string | null;
  lead_id: string | null;
  owner: { full_name: string | null } | null;
  leads: { id: string; contacts: { name: string } | null; pipelines: { key: string } | null } | null;
};

export function toTask(r: TaskRow): TaskItem {
  return {
    id: r.id,
    title: r.title,
    dueAt: r.due_at,
    doneAt: r.done_at,
    origin: r.origin,
    ownerId: r.owner_id,
    ownerName: r.owner?.full_name ?? null,
    createdBy: r.created_by,
    leadId: r.lead_id,
    leadName: r.leads?.contacts?.name ?? null,
    pipelineKey: r.leads?.pipelines?.key ?? null,
  };
}

const day = (d: Date | string) => formatInTimeZone(d, TIMEZONE, "yyyy-MM-dd");

export type TaskGroup = "atrasadas" | "hoje" | "proximas" | "concluidas";

/** Agrupa pelo dia no fuso de Teresina (SPEC 4.7). */
export function groupOf(t: TaskItem, now = new Date()): TaskGroup {
  if (t.doneAt) return "concluidas";
  if (new Date(t.dueAt) < now) return "atrasadas";
  return day(t.dueAt) === day(now) ? "hoje" : "proximas";
}

/** Rótulo curto do prazo: "hoje às 14:00", "amanhã", "12/10 às 09:00". */
export function dueLabel(dueAt: string, now = new Date()): string {
  const d = day(dueAt);
  const time = formatInTimeZone(dueAt, TIMEZONE, "HH:mm");
  if (d === day(now)) return `hoje às ${time}`;
  if (d === day(new Date(now.getTime() + 86_400_000))) return `amanhã às ${time}`;
  if (d === day(new Date(now.getTime() - 86_400_000))) return `ontem às ${time}`;
  return `${formatInTimeZone(dueAt, TIMEZONE, "dd/MM")} às ${time}`;
}

/** Valor padrão do campo de prazo: amanhã às 09:00, no horário de Teresina. */
export function defaultDueLocal(now = new Date()): string {
  return `${day(new Date(now.getTime() + 86_400_000))}T09:00`;
}
