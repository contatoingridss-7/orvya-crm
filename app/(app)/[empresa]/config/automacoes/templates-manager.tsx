"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { SelectField, TextField } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { Panel } from "@/components/ui/panel";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import type { Pipeline } from "@/lib/crm/types";
import { createTemplate, deleteTemplate, toggleTemplate, type ActionResult } from "./actions";

export type TemplateRow = { id: string; pipeline_id: string | null; title: string; active: boolean };

/** Tarefas prontas: aparecem na lista de "O que precisa ser feito"; o vendedor escolhe e edita se precisar. */
export function TemplatesManager({ slug, pipelines, templates, loadError }: { slug: string; pipelines: Pipeline[]; templates: TemplateRow[]; loadError: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();

  function run(fn: () => Promise<ActionResult>) {
    start(async () => {
      const r = await fn();
      toast(r.ok ? r.message : r.error, r.ok ? "ok" : "bad");
      if (r.ok) router.refresh();
    });
  }

  function onCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    setError(undefined);
    start(async () => {
      const r = await createTemplate(slug, {
        title: String(f.get("title") ?? ""),
        pipelineId: String(f.get("pipelineId") ?? ""),
      });
      if (r.ok) {
        toast(r.message, "ok");
        form.reset();
        router.refresh();
      } else setError(r.error);
    });
  }

  // Grupos: "Todos os funis" primeiro, depois cada funil na ordem da empresa.
  const groups = [
    { id: null as string | null, name: "Todos os funis" },
    ...pipelines.map((p) => ({ id: p.id as string | null, name: p.name })),
  ].map((g) => ({ ...g, items: templates.filter((t) => t.pipeline_id === g.id) }));

  return (
    <Panel
      title="Tarefas prontas"
      subtitle="Aparecem na lista de “O que precisa ser feito”, filtradas pelo funil do lead. O atendente escolhe, edita o texto se precisar e define o prazo."
    >
      {loadError && <Notice tone="bad">Não foi possível carregar as tarefas prontas. Rode a migration 0010 no Supabase.</Notice>}

      <div className="grid gap-4 md:grid-cols-2">
        {groups
          .filter((g) => g.items.length > 0)
          .map((g) => (
            <section key={g.id ?? "todos"}>
              <h3 className="mb-1 text-[13px] font-[650]">{g.name}</h3>
              <div className="row-list">
                {g.items.map((t) => (
                  <div key={t.id} className={`flex items-center gap-2.5 py-2 ${t.active ? "" : "opacity-55"}`}>
                    <span className="min-w-0 flex-1 text-[13.5px]">{t.title}</span>
                    <Switch label={`${t.active ? "Esconder" : "Mostrar"} ${t.title}`} checked={t.active} disabled={pending} onChange={(e) => run(() => toggleTemplate(slug, t.id, e.target.checked))} />
                    <Button size="sm" variant="ghost" className="danger" disabled={pending} onClick={() => run(() => deleteTemplate(slug, t.id))}>
                      Excluir
                    </Button>
                  </div>
                ))}
              </div>
            </section>
          ))}
      </div>
      {templates.length === 0 && !loadError && <div className="empty">Nenhuma tarefa pronta ainda.</div>}

      <h3 className="mt-5 mb-2.5 text-[13px] font-[650]">Nova tarefa pronta</h3>
      <form onSubmit={onCreate} className="grid gap-2.5">
        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] lg:items-end">
          <TextField label="Tarefa" name="title" required minLength={3} maxLength={200} placeholder="Ex.: enviar catálogo de cadeiras de rodas" className="sm:col-span-2 lg:col-span-1" />
          <SelectField label="Funil" name="pipelineId" defaultValue="">
            <option value="">Todos os funis</option>
            {pipelines.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </SelectField>
          <Button type="submit" variant="primary" loading={pending}>
            Incluir
          </Button>
        </div>
        {error && <Notice tone="bad">{error}</Notice>}
      </form>
    </Panel>
  );
}
