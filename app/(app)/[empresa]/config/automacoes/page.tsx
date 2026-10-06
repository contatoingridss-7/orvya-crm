import type { Metadata } from "next";
import { PageHeader } from "@/components/app-shell/page-header";
import { Notice } from "@/components/ui/notice";
import { requireRole } from "@/lib/auth/viewer";
import type { Pipeline, Stage } from "@/lib/crm/types";
import { createClient } from "@/lib/supabase/server";
import { RulesManager, type Rule } from "./rules-manager";

export const metadata: Metadata = { title: "Automações" };

type RuleRow = { id: string; pipeline_id: string; stage_id: string; task_title: string; due_in_days: number; enabled: boolean };
type StageRow = Stage & { pipeline_id: string };

export default async function AutomacoesPage({ params }: { params: Promise<{ empresa: string }> }) {
  const { company } = await requireRole((await params).empresa, ["admin", "gestor"]);
  const supabase = await createClient();

  const [pipelinesRes, stagesRes, rulesRes] = await Promise.all([
    supabase.from("pipelines").select("id, key, name, hint").eq("company_id", company.id).order("position").returns<Pipeline[]>(),
    supabase.from("stages").select("id, key, name, kind, position, pipeline_id").eq("company_id", company.id).order("position").returns<StageRow[]>(),
    supabase.from("automation_rules").select("id, pipeline_id, stage_id, task_title, due_in_days, enabled").eq("company_id", company.id).order("created_at").returns<RuleRow[]>(),
  ]);

  const pipelines = pipelinesRes.data ?? [];
  const stages = stagesRes.data ?? [];
  const pipelineOrder = new Map(pipelines.map((p, i) => [p.id, i]));
  const stageOrder = new Map(stages.map((s) => [s.id, s.position]));

  const rules: Rule[] = (rulesRes.data ?? [])
    .map((r) => ({
      id: r.id,
      pipelineId: r.pipeline_id,
      stageId: r.stage_id,
      pipelineName: pipelines.find((p) => p.id === r.pipeline_id)?.name ?? "Funil",
      stageName: stages.find((s) => s.id === r.stage_id)?.name ?? "Etapa",
      taskTitle: r.task_title,
      dueInDays: r.due_in_days,
      enabled: r.enabled,
    }))
    .sort(
      (a, b) =>
        (pipelineOrder.get(a.pipelineId) ?? 0) - (pipelineOrder.get(b.pipelineId) ?? 0) ||
        (stageOrder.get(a.stageId) ?? 0) - (stageOrder.get(b.stageId) ?? 0),
    );

  return (
    <>
      <PageHeader title="Automações" subtitle={`${company.name}: o que o CRM faz sozinho quando um lead muda de etapa`} />
      <div className="content grid gap-4">
        {rulesRes.error && <Notice tone="bad">Não foi possível carregar as regras. Recarregue a página.</Notice>}
        <RulesManager
          slug={company.slug}
          isLoc={company.slug === "locpress"}
          rules={rules}
          pipelines={pipelines}
          stages={stages.map((s) => ({ id: s.id, name: s.name, kind: s.kind, pipelineId: s.pipeline_id }))}
        />
      </div>
    </>
  );
}
