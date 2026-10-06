"use client";

import { useRouter } from "next/navigation";
import type { TaskItem } from "@/lib/crm/tasks";
import { TaskLine } from "../tarefas/task-line";

export function MyTasks({ tasks, slug, viewerId }: { tasks: TaskItem[]; slug: string; viewerId: string }) {
  const router = useRouter();
  if (!tasks.length) return <div className="empty">Nenhuma tarefa para hoje.</div>;
  return (
    <div className="row-list">
      {tasks.map((t) => (
        <TaskLine key={t.id} task={t} slug={slug} viewerId={viewerId} manager={false} onChanged={() => router.refresh()} />
      ))}
    </div>
  );
}
