"use client";

import Link from "next/link";
import { useTransition } from "react";
import { Pill } from "@/components/ui/pill";
import { useToast } from "@/components/ui/toast";
import { dueLabel, groupOf, type TaskItem } from "@/lib/crm/tasks";
import { deleteTask, postponeTask, setTaskDone, type ActionResult } from "./actions";

type Props = {
  task: TaskItem;
  slug: string;
  viewerId: string;
  manager: boolean;
  /** Dentro do detalhe do lead não precisa repetir o nome do lead. */
  showLead?: boolean;
  onChanged?: () => void;
};

/** Uma tarefa com check para concluir, prazo, responsável e ações rápidas. */
export function TaskLine({ task: t, slug, viewerId, manager, showLead = true, onChanged }: Props) {
  const toast = useToast();
  const [pending, start] = useTransition();
  const canChange = manager || t.ownerId === viewerId;
  const canDelete = manager || t.createdBy === viewerId;
  const group = groupOf(t);

  function run(fn: () => Promise<ActionResult>) {
    start(async () => {
      const r = await fn();
      if (r.ok) {
        if (r.message) toast(r.message, "ok");
        onChanged?.();
      } else toast(r.error, "bad");
    });
  }

  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 ${pending ? "opacity-60" : ""}`}>
      <input
        type="checkbox"
        className="h-[18px] w-[18px] flex-none accent-accent"
        checked={!!t.doneAt}
        disabled={!canChange || pending}
        aria-label={t.doneAt ? `Reabrir: ${t.title}` : `Concluir: ${t.title}`}
        onChange={(e) => run(() => setTaskDone(slug, t.id, e.target.checked))}
      />
      <div className="min-w-[180px] flex-1">
        <b className={`block text-[13.5px] font-semibold ${t.doneAt ? "text-muted line-through" : "text-title"}`}>{t.title}</b>
        <small className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted">
          {showLead && t.leadId && t.leadName && (
            <>
              <Link className="font-semibold text-tint-ink hover:underline" href={`/${slug}/funil?${t.pipelineKey ? `funil=${t.pipelineKey}&` : ""}lead=${t.leadId}`}>
                {t.leadName}
              </Link>
              ·
            </>
          )}
          <span>{t.ownerName ?? "Sem responsável"}</span>
          {t.origin === "automation" && <Pill tone="warn">Automação</Pill>}
        </small>
      </div>
      {t.doneAt ? (
        <span className="text-xs text-muted">Concluída</span>
      ) : (
        <Pill tone={group === "atrasadas" ? "bad" : group === "hoje" ? "warn" : "neutral"}>{dueLabel(t.dueAt)}</Pill>
      )}
      {!t.doneAt && canChange && (
        <button type="button" className="text-xs font-semibold text-tint-ink hover:underline" disabled={pending} onClick={() => run(() => postponeTask(slug, t.id, 1))}>
          Adiar 1 dia
        </button>
      )}
      {canDelete && (
        <button type="button" className="text-xs font-semibold text-[var(--bad-fg)] hover:underline" disabled={pending} onClick={() => run(() => deleteTask(slug, t.id))}>
          Excluir
        </button>
      )}
    </div>
  );
}
