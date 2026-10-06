"use client";

import { useState, useTransition, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { SelectField, TextField } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { useToast } from "@/components/ui/toast";
import { defaultDueLocal } from "@/lib/crm/tasks";
import type { Person } from "@/lib/crm/types";
import { createTask } from "./actions";

type Props = {
  slug: string;
  manager: boolean;
  viewerId: string;
  people: Person[];
  /** Lista de leads para escolher; ausente quando a tarefa já é de um lead (detalhe do lead). */
  leads?: { id: string; name: string }[];
  leadId?: string;
  /** Responsável sugerido (no detalhe do lead: o responsável do lead). */
  defaultOwnerId?: string | null;
  onCreated?: () => void;
  compact?: boolean;
};

export function NewTaskForm({ slug, manager, viewerId, people, leads, leadId, defaultOwnerId, onCreated, compact }: Props) {
  const toast = useToast();
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const get = (k: string) => String(f.get(k) ?? "");
    setError(undefined);
    start(async () => {
      const r = await createTask(slug, {
        title: get("title"),
        leadId: leadId ?? get("leadId"),
        dueLocal: get("dueLocal"),
        ownerId: manager ? get("ownerId") : viewerId,
      });
      if (r.ok) {
        toast(r.message ?? "Tarefa criada.", "ok");
        form.reset();
        onCreated?.();
      } else setError(r.error);
    });
  }

  const ownerDefault = manager ? (defaultOwnerId ?? viewerId) : viewerId;

  return (
    <form onSubmit={onSubmit} className="grid gap-2.5">
      <div className={`grid gap-2.5 ${compact ? "sm:grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,1.3fr)_190px_minmax(0,1fr)_auto] lg:items-end"}`}>
        <TextField label="O que precisa ser feito" name="title" required minLength={3} placeholder="Ex.: ligar para confirmar a entrega" className={compact ? "sm:col-span-2" : ""} />
        {!leadId && (
          <SelectField label="Lead" name="leadId" defaultValue="">
            <option value="">Sem lead</option>
            {(leads ?? []).map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </SelectField>
        )}
        <TextField label="Prazo" name="dueLocal" type="datetime-local" required defaultValue={defaultDueLocal()} />
        {manager ? (
          <SelectField label="Responsável" name="ownerId" defaultValue={ownerDefault}>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.id === viewerId ? `${p.name} (você)` : p.name}
              </option>
            ))}
          </SelectField>
        ) : (
          <TextField label="Responsável" value="Você" disabled readOnly />
        )}
        <Button type="submit" variant={compact ? "soft" : "primary"} loading={pending} className={compact ? "justify-self-start" : ""}>
          Adicionar
        </Button>
      </div>
      {error && <Notice tone="bad">{error}</Notice>}
    </form>
  );
}
