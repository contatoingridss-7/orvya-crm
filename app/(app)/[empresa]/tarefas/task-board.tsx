"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Panel } from "@/components/ui/panel";
import { Pill } from "@/components/ui/pill";
import { groupOf, type TaskGroup, type TaskItem } from "@/lib/crm/tasks";
import type { Person } from "@/lib/crm/types";
import { NewTaskForm } from "./new-task-form";
import { TaskLine } from "./task-line";

type Props = {
  slug: string;
  tasks: TaskItem[];
  leads: { id: string; name: string }[];
  people: Person[];
  manager: boolean;
  viewerId: string;
  doneWindowDays: number;
};

const GROUPS: { id: TaskGroup; label: string }[] = [
  { id: "atrasadas", label: "Atrasadas" },
  { id: "hoje", label: "Hoje" },
  { id: "proximas", label: "Próximos dias" },
  { id: "concluidas", label: "Concluídas" },
];

export function TaskBoard({ slug, tasks, leads, people, manager, viewerId, doneWindowDays }: Props) {
  const router = useRouter();
  // Vendedor começa vendo as dele; gestor vê a equipe toda.
  const [owner, setOwner] = useState(manager ? "" : viewerId);
  const refresh = () => router.refresh();

  const grouped = useMemo(() => {
    const list = owner === "sem" ? tasks.filter((t) => !t.ownerId) : owner ? tasks.filter((t) => t.ownerId === owner) : tasks;
    const map: Record<TaskGroup, TaskItem[]> = { atrasadas: [], hoje: [], proximas: [], concluidas: [] };
    for (const t of list) map[groupOf(t)].push(t);
    map.concluidas.sort((a, b) => (b.doneAt ?? "").localeCompare(a.doneAt ?? ""));
    return map;
  }, [tasks, owner]);

  return (
    <>
      <Panel title="Nova tarefa" subtitle="Ligue a tarefa a um lead para ninguém perder o contexto.">
        <NewTaskForm slug={slug} manager={manager} viewerId={viewerId} people={people} leads={leads} onCreated={refresh} />
      </Panel>

      <Panel
        title={manager ? "Tarefas da equipe" : "Tarefas"}
        actions={
          <select className="inp !w-auto" value={owner} onChange={(e) => setOwner(e.target.value)} aria-label="Filtrar por responsável">
            <option value="">{manager ? "Todos" : "Todas que eu vejo"}</option>
            {manager ? (
              <>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.id === viewerId ? `${p.name} (você)` : p.name}
                  </option>
                ))}
                <option value="sem">Sem responsável</option>
              </>
            ) : (
              <option value={viewerId}>Minhas</option>
            )}
          </select>
        }
      >
        {GROUPS.map((g, i) => {
          const items = grouped[g.id];
          return (
            <div key={g.id} className={i === 0 ? "" : "mt-5"}>
              <div className="mb-1 flex items-center gap-2 text-[13px] font-[650] text-title">
                {g.label}
                <Pill tone={g.id === "atrasadas" && items.length ? "bad" : g.id === "hoje" && items.length ? "warn" : "neutral"}>{items.length}</Pill>
                {g.id === "concluidas" && <span className="text-xs font-normal text-muted">últimos {doneWindowDays} dias</span>}
              </div>
              {items.length === 0 ? (
                <p className="m-0 text-[13px] text-muted">{g.id === "atrasadas" ? "Nada atrasado." : "Nada aqui."}</p>
              ) : (
                <div className="row-list">
                  {items.map((t) => (
                    <TaskLine key={t.id} task={t} slug={slug} viewerId={viewerId} manager={manager} onChanged={refresh} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </Panel>
    </>
  );
}
