"use client";

import { useMemo, useState, useTransition, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { SelectField, TextField } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { useToast } from "@/components/ui/toast";
import { defaultDueLocal, type TaskTemplate } from "@/lib/crm/tasks";
import type { Person } from "@/lib/crm/types";
import { createTask } from "./actions";

type Props = {
  slug: string;
  manager: boolean;
  viewerId: string;
  people: Person[];
  /** Lista de leads para escolher; ausente quando a tarefa já é de um lead (detalhe do lead). */
  leads?: { id: string; name: string; pipelineId: string }[];
  leadId?: string;
  /** Funil do lead fixo (detalhe do lead), para filtrar as tarefas prontas. */
  pipelineId?: string;
  /** Tarefas prontas da empresa (Automações → Tarefas prontas). */
  templates?: TaskTemplate[];
  /** Responsável sugerido (no detalhe do lead: o responsável do lead). */
  defaultOwnerId?: string | null;
  onCreated?: () => void;
  compact?: boolean;
};

const OTHER = "";

export function NewTaskForm({ slug, manager, viewerId, people, leads, leadId, pipelineId, templates = [], defaultOwnerId, onCreated, compact }: Props) {
  const toast = useToast();
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const [title, setTitle] = useState("");
  const [due, setDue] = useState(defaultDueLocal);
  const [picked, setPicked] = useState(OTHER);
  const [selectedLead, setSelectedLead] = useState("");

  // Tarefas prontas do funil do lead + as que valem para todos os funis.
  const funnel = pipelineId ?? leads?.find((l) => l.id === selectedLead)?.pipelineId ?? null;
  const options = useMemo(() => {
    const seen = new Set<string>();
    return templates.filter((t) => {
      if (funnel && t.pipelineId && t.pipelineId !== funnel) return false;
      if (seen.has(t.title)) return false;
      seen.add(t.title);
      return true;
    });
  }, [templates, funnel]);

  function pick(id: string) {
    setPicked(id);
    const t = options.find((o) => o.id === id);
    if (!t) return;
    // Só antecipa o texto (editável); o prazo quem escolhe é o atendente.
    setTitle(t.title);
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const get = (k: string) => String(f.get(k) ?? "");
    setError(undefined);
    start(async () => {
      const r = await createTask(slug, {
        title,
        leadId: leadId ?? selectedLead,
        dueLocal: due,
        ownerId: manager ? get("ownerId") : viewerId,
      });
      if (r.ok) {
        toast(r.message ?? "Tarefa criada.", "ok");
        setTitle("");
        setPicked(OTHER);
        setDue(defaultDueLocal());
        onCreated?.();
      } else setError(r.error);
    });
  }

  const ownerDefault = manager ? (defaultOwnerId ?? viewerId) : viewerId;

  return (
    <form onSubmit={onSubmit} className="grid gap-2.5">
      <div className={`grid gap-2.5 ${compact ? "sm:grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,1.3fr)_190px_minmax(0,1fr)_auto] lg:items-end"}`}>
        <div className={`grid gap-1.5 ${compact ? "sm:col-span-2" : ""}`}>
          {options.length > 0 && (
            <SelectField label="O que precisa ser feito" value={picked} onChange={(e) => pick(e.target.value)}>
              <option value={OTHER}>Escolha uma tarefa pronta ou escreva abaixo</option>
              {options.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </SelectField>
          )}
          <TextField
            label={options.length > 0 ? "Texto da tarefa (pode editar)" : "O que precisa ser feito"}
            name="title"
            required
            minLength={3}
            maxLength={200}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Ex.: ligar para confirmar a entrega"
          />
        </div>
        {!leadId && (
          <SelectField label="Lead" name="leadId" value={selectedLead} onChange={(e) => setSelectedLead(e.target.value)}>
            <option value="">Sem lead</option>
            {(leads ?? []).map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </SelectField>
        )}
        <TextField label="Prazo" name="dueLocal" type="datetime-local" required value={due} onChange={(e) => setDue(e.target.value)} />
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
