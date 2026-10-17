"use client";

import { useRouter } from "next/navigation";
import type { TaskItem } from "@/lib/crm/tasks";
import { TaskLine } from "../tarefas/task-line";

/** Tarefas atrasadas há mais de 1 dia, para o gestor cobrar (concluir, adiar ou reatribuir pelo lead). */
export function LateTasks({ slug, tasks, viewerId }: { slug: string; tasks: TaskItem[]; viewerId: string }) {
  const router = useRouter();
  if (!tasks.length) return <div className="empty">Nenhuma tarefa atrasada há mais de 1 dia. Equipe em dia.</div>;
  return (
    <div className="row-list">
      {tasks.map((t) => (
        <TaskLine key={t.id} task={t} slug={slug} viewerId={viewerId} manager onChanged={() => router.refresh()} />
      ))}
    </div>
  );
}
