import type { Metadata } from "next";
import { subDays } from "date-fns";
import { PageHeader } from "@/components/app-shell/page-header";
import { Notice } from "@/components/ui/notice";
import { isManager, type MemberRole } from "@/lib/auth/roles";
import { requireCompany } from "@/lib/auth/viewer";
import { TASK_SELECT, toTask, type TaskRow } from "@/lib/crm/tasks";
import type { Person } from "@/lib/crm/types";
import { createClient } from "@/lib/supabase/server";
import { TaskBoard } from "./task-board";

export const metadata: Metadata = { title: "Tarefas" };

const DONE_WINDOW_DAYS = 14;

type MemberRow = { role: MemberRole; profiles: { id: string; full_name: string | null; email: string | null; active: boolean } | null };
type LeadOptionRow = { id: string; contacts: { name: string } | null; stages: { kind: string } | null };

export default async function TarefasPage({ params }: { params: Promise<{ empresa: string }> }) {
  const { viewer, company } = await requireCompany((await params).empresa);
  const manager = isManager(company.role);
  const supabase = await createClient();
  const doneSince = subDays(new Date(), DONE_WINDOW_DAYS).toISOString();

  const [tasksRes, leadsRes, membersRes] = await Promise.all([
    supabase
      .from("tasks")
      .select(TASK_SELECT)
      .eq("company_id", company.id)
      .or(`done_at.is.null,done_at.gte."${doneSince}"`)
      .order("due_at")
      .limit(1000)
      .returns<TaskRow[]>(),
    // Leads abertos que a pessoa vê (o RLS já filtra os do vendedor).
    supabase
      .from("leads")
      .select("id, contacts(name), stages(kind)")
      .eq("company_id", company.id)
      .is("closed_at", null)
      .order("updated_at", { ascending: false })
      .limit(500)
      .returns<LeadOptionRow[]>(),
    supabase.from("memberships").select("role, profiles(id, full_name, email, active)").eq("company_id", company.id).returns<MemberRow[]>(),
  ]);

  const people: Person[] = (membersRes.data ?? [])
    .filter((m) => m.profiles?.active)
    .map((m) => ({ id: m.profiles!.id, name: m.profiles!.full_name || m.profiles!.email || "Sem nome" }));
  if (viewer.isAdmin && !people.some((p) => p.id === viewer.id)) people.push({ id: viewer.id, name: viewer.fullName });
  people.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  const leads = (leadsRes.data ?? [])
    .filter((l) => l.stages?.kind === "open")
    .map((l) => ({ id: l.id, name: l.contacts?.name ?? "Sem nome" }))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  return (
    <>
      <PageHeader title="Tarefas" subtitle={`${company.name}: próximos passos da equipe`} />
      <div className="content grid gap-4">
        {tasksRes.error && <Notice tone="bad">Não foi possível carregar as tarefas. Recarregue a página.</Notice>}
        <TaskBoard
          slug={company.slug}
          tasks={(tasksRes.data ?? []).map(toTask)}
          leads={leads}
          people={people}
          manager={manager}
          viewerId={viewer.id}
          doneWindowDays={DONE_WINDOW_DAYS}
        />
      </div>
    </>
  );
}
