"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { SelectField, TextField } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { Panel } from "@/components/ui/panel";
import { Pill } from "@/components/ui/pill";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import type { Pipeline, StageKind } from "@/lib/crm/types";
import { createRule, deleteRule, toggleRule, type ActionResult } from "./actions";

export type Rule = {
  id: string;
  pipelineId: string;
  stageId: string;
  pipelineName: string;
  stageName: string;
  taskTitle: string;
  dueInDays: number;
  enabled: boolean;
};

type StageOption = { id: string; name: string; kind: StageKind; pipelineId: string };

// Do protótipo (tela Automações): regras que o sistema sempre aplica.
const FIXED_RULES: [string, string][] = [
  ["Ao mover para Perdido, o motivo é obrigatório", "Alimenta o relatório de perdas por motivo."],
  ["Se a equipe envia uma mensagem, a IA pausa naquela conversa", "Evita a IA e o vendedor responderem ao mesmo tempo."],
  ["Desconto fora da política, urgência ou pedido de atendente vão para Precisa de mim", "A IA nunca inventa condição comercial."],
  ["Fora da janela de 24 horas do WhatsApp, só modelos aprovados", "Regra da API oficial da Meta. Vale para a equipe e para a IA."],
  ["Lead aberto sem contato há 7 dias aparece em Reativar leads parados", "O envio sempre passa por revisão e mostra o custo estimado."],
];
const LOC_FIXED: [string, string][] = [
  ["Locação: o valor é sempre negociado por um vendedor", "A IA coleta equipamento, período e endereço e passa para a equipe."],
  ["Contrato de locação a 30 dias do fim aparece no Painel", "Janela para oferecer a renovação."],
];

const dueText = (d: number) => (d === 0 ? "Prazo para o mesmo dia" : `Prazo de ${d} ${d === 1 ? "dia" : "dias"}`);

export function RulesManager({ slug, isLoc, rules, pipelines, stages }: { slug: string; isLoc: boolean; rules: Rule[]; pipelines: Pipeline[]; stages: StageOption[] }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [pipelineId, setPipelineId] = useState(pipelines[0]?.id ?? "");
  const [error, setError] = useState<string>();

  function run(fn: () => Promise<ActionResult>, after?: () => void) {
    start(async () => {
      const r = await fn();
      if (r.ok) {
        toast(r.message, "ok");
        after?.();
        router.refresh();
      } else toast(r.error, "bad");
    });
  }

  function onCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    setError(undefined);
    start(async () => {
      const r = await createRule(slug, {
        pipelineId,
        stageId: String(f.get("stageId") ?? ""),
        taskTitle: String(f.get("taskTitle") ?? ""),
        dueInDays: String(f.get("dueInDays") ?? "1"),
      });
      if (r.ok) {
        toast(r.message, "ok");
        form.reset();
        router.refresh();
      } else setError(r.error);
    });
  }

  const fixed = isLoc ? [...FIXED_RULES, ...LOC_FIXED] : FIXED_RULES;

  return (
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <Panel title="Regras por etapa" subtitle="Quando um lead entra na etapa, o CRM cria a tarefa para o responsável daquele lead.">
        {rules.length === 0 ? (
          <div className="empty">Nenhuma regra ainda.</div>
        ) : (
          <div className="row-list">
            {rules.map((r) => (
              <div key={r.id} className={`flex flex-wrap items-center gap-3 py-3.5 ${r.enabled ? "" : "opacity-60"}`}>
                <div className="min-w-[200px] flex-1">
                  <p className="m-0 text-[13.5px]">
                    Entrou em <b className="font-semibold text-title">{r.stageName}</b> no funil <b className="font-semibold text-title">{r.pipelineName}</b>: criar
                    a tarefa <b className="font-semibold text-title">“{r.taskTitle}”</b>
                  </p>
                  <small className="text-xs text-muted">{dueText(r.dueInDays)}</small>
                </div>
                <Switch label={`${r.enabled ? "Desligar" : "Ligar"} regra`} checked={r.enabled} disabled={pending} onChange={(e) => run(() => toggleRule(slug, r.id, e.target.checked))} />
                <Button size="sm" variant="ghost" className="danger" disabled={pending} onClick={() => run(() => deleteRule(slug, r.id))}>
                  Excluir
                </Button>
              </div>
            ))}
          </div>
        )}

        <h3 className="mt-5 mb-2.5 text-[13px] font-[650]">Nova regra</h3>
        <form onSubmit={onCreate} className="grid gap-2.5">
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.6fr)_110px_auto] lg:items-end">
            <SelectField label="Funil" value={pipelineId} onChange={(e) => setPipelineId(e.target.value)}>
              {pipelines.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </SelectField>
            <SelectField key={pipelineId} label="Etapa" name="stageId">
              {stages
                .filter((s) => s.pipelineId === pipelineId && s.kind !== "lost")
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </SelectField>
            <TextField label="Tarefa a criar" name="taskTitle" required minLength={3} placeholder="Ex.: enviar vídeo de uso do equipamento" className="sm:col-span-2 lg:col-span-1" />
            <TextField label="Prazo em dias" name="dueInDays" type="number" min={0} max={365} defaultValue={1} required />
            <Button type="submit" variant="primary" loading={pending}>
              Criar regra
            </Button>
          </div>
          {error && <Notice tone="bad">{error}</Notice>}
        </form>
      </Panel>

      <Panel title="Regras fixas" subtitle="Valem sempre e protegem a operação.">
        <div className="row-list">
          {fixed.map(([title, sub]) => (
            <div key={title} className="flex items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="m-0 text-[13.5px]">{title}</p>
                <small className="text-xs text-muted">{sub}</small>
              </div>
              <Pill tone="ok">Sempre ativa</Pill>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
