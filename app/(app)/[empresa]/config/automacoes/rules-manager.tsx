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
import type { Pipeline, StageKind, StageLogistics } from "@/lib/crm/types";
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
  /** stage = ao entrar na etapa; stale = parado na etapa; delivered = quando a expedição confirma a entrega. */
  trigger: "stage" | "delivered" | "stale";
  afterDays: number | null;
  repeatDays: number | null;
};

type Trigger = Rule["trigger"];

type StageOption = { id: string; name: string; kind: StageKind; logistics: StageLogistics | null; pipelineId: string };

// Do protótipo (tela Automações): regras que o sistema sempre aplica.
const FIXED_RULES: [string, string][] = [
  ["Ao mover para Perdido, o motivo é obrigatório", "Alimenta o relatório de perdas por motivo."],
  ["Se a equipe envia uma mensagem, a IA pausa naquela conversa", "Evita a IA e o vendedor responderem ao mesmo tempo."],
  ["Desconto fora da política, urgência ou pedido de atendente vão para Precisa de mim", "A IA nunca inventa condição comercial."],
  ["Fora da janela de 24 horas do WhatsApp, só modelos aprovados", "Regra da API oficial da Meta. Vale para a equipe e para a IA."],
  ["Lead aberto sem contato há 7 dias aparece em Reativar leads parados", "O envio sempre passa por revisão e mostra o custo estimado."],
  ["Cliente sem resposta há 5 minutos aparece em Precisa de mim", "Com cronômetro e contador vermelho no menu."],
  ["Entrega ou adaptação só vai para a expedição com data, hora e endereço", "Ao confirmar a entrega, o negócio é concluído no funil."],
  ["Tarefa atrasada há mais de 1 dia aparece para o gestor em Precisa de mim", "Com o nome do responsável, para cobrar sem abrir o funil."],
];
const LOC_FIXED: [string, string][] = [
  ["Locação: o valor é sempre negociado por um vendedor", "A IA coleta equipamento, período e endereço e passa para a equipe."],
  ["Contrato de locação a 30 dias do fim aparece no Painel", "Janela para oferecer a renovação."],
];

const dueText = (d: number) => (d === 0 ? "Prazo para o mesmo dia" : `Prazo de ${d} ${d === 1 ? "dia" : "dias"}`);
const deliveredDueText = (d: number) => (d === 0 ? "Vence no dia da entrega" : d === 1 ? "Vence 24 horas após a entrega" : `Vence ${d} dias após a entrega`);

export function RulesManager({ slug, isLoc, rules, pipelines, stages }: { slug: string; isLoc: boolean; rules: Rule[]; pipelines: Pipeline[]; stages: StageOption[] }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [pipelineId, setPipelineId] = useState(pipelines[0]?.id ?? "");
  const [stageId, setStageId] = useState("");
  const [trigger, setTrigger] = useState<Trigger>("stage");
  const [repeat, setRepeat] = useState(false);
  const pipelineStages = stages.filter((s) => s.pipelineId === pipelineId && s.kind !== "lost");
  const selectedStage = pipelineStages.find((s) => s.id === stageId) ?? pipelineStages[0];
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
        stageId: selectedStage?.id ?? "",
        taskTitle: String(f.get("taskTitle") ?? ""),
        dueInDays: String(f.get("dueInDays") ?? "1"),
        trigger: trigger === "delivered" && !selectedStage?.logistics ? "stage" : trigger,
        afterDays: trigger === "stale" ? String(f.get("afterDays") ?? "") : undefined,
        repeatDays: repeat && trigger !== "stale" ? String(f.get("repeatDays") ?? "") : undefined,
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
      <Panel title="Regras por etapa" subtitle="O CRM cria a tarefa para o responsável do lead: ao entrar na etapa, quando fica parado nela ou quando a entrega é confirmada.">
        {rules.length === 0 ? (
          <div className="empty">Nenhuma regra ainda.</div>
        ) : (
          <div className="row-list">
            {rules.map((r) => (
              <div key={r.id} className={`flex flex-wrap items-center gap-3 py-3.5 ${r.enabled ? "" : "opacity-60"}`}>
                <div className="min-w-[200px] flex-1">
                  <p className="m-0 text-[13.5px]">
                    {r.trigger === "delivered" ? "Expedição confirmou a entrega em " : r.trigger === "stale" ? `Parado há ${r.afterDays} ${r.afterDays === 1 ? "dia" : "dias"} em ` : "Entrou em "}
                    <b className="font-semibold text-title">{r.stageName}</b> no funil <b className="font-semibold text-title">{r.pipelineName}</b>: criar a tarefa{" "}
                    <b className="font-semibold text-title">“{r.taskTitle}”</b>
                  </p>
                  <small className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                    {r.trigger === "delivered" && <Pill tone="ind">Ao entregar</Pill>}
                    {r.trigger === "stale" && <Pill tone="warn">Parado na etapa</Pill>}
                    {r.repeatDays && <Pill tone="ok">Repete a cada {r.repeatDays} dias</Pill>}
                    {r.trigger === "delivered" ? deliveredDueText(r.dueInDays) : dueText(r.dueInDays)}
                  </small>
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
            <SelectField
              label="Funil"
              value={pipelineId}
              onChange={(e) => {
                setPipelineId(e.target.value);
                setStageId("");
                setTrigger("stage");
              }}
            >
              {pipelines.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </SelectField>
            <SelectField
              key={pipelineId}
              label="Etapa"
              value={selectedStage?.id ?? ""}
              onChange={(e) => {
                setStageId(e.target.value);
                setTrigger("stage");
              }}
            >
              {pipelineStages.map((s) => (
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
          <div className="chips" role="group" aria-label="Quando criar a tarefa">
            <button type="button" className="chip" aria-pressed={trigger === "stage"} onClick={() => setTrigger("stage")}>
              Ao entrar na etapa
            </button>
            {selectedStage?.kind === "open" && (
              <button type="button" className="chip" aria-pressed={trigger === "stale"} onClick={() => setTrigger("stale")}>
                Parado na etapa
              </button>
            )}
            {selectedStage?.logistics && (
              <button type="button" className="chip" aria-pressed={trigger === "delivered"} onClick={() => setTrigger("delivered")}>
                Ao entregar (confirmado pela expedição)
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-end gap-2.5">
            {trigger === "stale" ? (
              <TextField label="Parado há quantos dias" name="afterDays" type="number" min={1} max={365} defaultValue={3} required className="w-44" />
            ) : (
              <label className="flex items-center gap-2 text-[13px]">
                <input type="checkbox" className="accent-accent" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} />
                Ao concluir, repetir a tarefa
              </label>
            )}
            {repeat && trigger !== "stale" && (
              <TextField label="A cada quantos dias" name="repeatDays" type="number" min={1} max={365} defaultValue={30} required className="w-44" />
            )}
          </div>
          {trigger === "stale" && (
            <p className="m-0 text-xs text-muted">O CRM confere de hora em hora. Cria uma tarefa por lead cada vez que ele fica parado na etapa (não repete enquanto continuar parado).</p>
          )}
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
