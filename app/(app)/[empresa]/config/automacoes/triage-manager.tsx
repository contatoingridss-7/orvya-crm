"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { Panel } from "@/components/ui/panel";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { saveTriage } from "./triage-actions";

export type Triage = { enabled: boolean; intro: string; options: { title: string; pipelineId: string }[] };

/**
 * Primeiro contato no WhatsApp sem palavra-chave: o cliente recebe até 3 botões de assunto;
 * o botão leva o lead ao funil escolhido e, pelo rodízio, ao vendedor de lá.
 */
export function TriageManager({
  slug,
  companyName,
  pipelines,
  settings,
  loadError,
}: {
  slug: string;
  companyName: string;
  pipelines: { id: string; name: string }[];
  settings: Triage | null;
  loadError: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [enabled, setEnabled] = useState(settings?.enabled ?? false);
  const [intro, setIntro] = useState(settings?.intro ?? `Olá! Aqui é a ${companyName}. Para te atender mais rápido, escolha o assunto:`);
  const [options, setOptions] = useState<{ title: string; pipelineId: string }[]>(() => {
    const list = settings?.options?.length ? settings.options : [{ title: "", pipelineId: pipelines[0]?.id ?? "" }];
    return [...list, ...Array(3).fill(null).map(() => ({ title: "", pipelineId: pipelines[0]?.id ?? "" }))].slice(0, 3);
  });
  const [error, setError] = useState<string>();

  function save() {
    setError(undefined);
    start(async () => {
      const r = await saveTriage(slug, { enabled, intro, options: options.filter((o) => o.title.trim()) });
      if (r.ok) {
        toast(r.message, "ok");
        router.refresh();
      } else setError(r.error);
    });
  }

  return (
    <Panel
      title="Triagem no WhatsApp"
      subtitle="Quem escreve pela primeira vez sem palavra-chave recebe botões de assunto. O botão escolhido leva o lead ao funil certo e, pelo rodízio, ao vendedor de lá. Sem custo."
      actions={<Switch label={enabled ? "Desligar triagem" : "Ligar triagem"} checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />}
    >
      {loadError && <Notice tone="bad">Não foi possível carregar. Rode a migration 0030 no Supabase.</Notice>}
      <div className="grid gap-3">
        <label className="grid gap-1 text-[13px]">
          <span className="text-muted">Mensagem</span>
          <textarea className="inp" rows={2} maxLength={1024} value={intro} onChange={(e) => setIntro(e.target.value)} />
        </label>
        {options.map((o, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2 text-[13px]">
            <span className="w-[64px] text-xs font-semibold text-muted">Botão {i + 1}</span>
            <input
              className="inp !w-[200px]"
              maxLength={20}
              placeholder={i === 0 ? "Ex.: CPAP e apneia" : "(opcional)"}
              aria-label={`Texto do botão ${i + 1}`}
              value={o.title}
              onChange={(e) => setOptions((list) => list.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))}
            />
            <span className="text-muted">leva ao funil</span>
            <select
              className="inp !w-auto"
              aria-label={`Funil do botão ${i + 1}`}
              value={o.pipelineId}
              onChange={(e) => setOptions((list) => list.map((x, j) => (j === i ? { ...x, pipelineId: e.target.value } : x)))}
            >
              {pipelines.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        ))}
        <small className="text-xs text-muted">Até 20 caracteres por botão (limite do WhatsApp). Botão sem texto não aparece.</small>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" loading={pending} onClick={save}>
            Salvar triagem
          </Button>
          {error && <Notice tone="bad">{error}</Notice>}
        </div>
      </div>
    </Panel>
  );
}
