import type { Metadata } from "next";
import { PageHeader } from "@/components/app-shell/page-header";
import { Notice } from "@/components/ui/notice";
import { requireRole } from "@/lib/auth/viewer";
import type { Pipeline, Stage } from "@/lib/crm/types";
import { createClient } from "@/lib/supabase/server";
import { RulesManager, type Rule } from "./rules-manager";
import { TemplatesManager, type TemplateRow } from "./templates-manager";

export const metadata: Metadata = { title: "Automações" };

const TRIGGER_ORDER: Record<Rule["trigger"], number> = { stage: 0, stale: 1, delivered: 2 };

type RuleRow = {
  id: string;
  pipeline_id: string;
  stage_id: string;
  task_title: string;
  due_in_days: number;
  enabled: boolean;
  trigger_event: Rule["trigger"];
  after_days: number | null;
  repeat_days: number | null;
};
type StageRow = Stage & { pipeline_id: string };

export default async function AutomacoesPage({ params }: { params: Promise<{ empresa: string }> }) {
  const { company } = await requireRole((await params).empresa, ["admin", "gestor"]);
  const supabase = await createClient();

  const [pipelinesRes, stagesRes, rulesRes, templatesRes] = await Promise.all([
    supabase.from("pipelines").select("id, key, name, hint").eq("company_id", company.id).order("position").returns<Pipeline[]>(),
    supabase.from("stages").select("id, key, name, kind, position, logistics, pipeline_id").eq("company_id", company.id).order("position").returns<StageRow[]>(),
    supabase.from("automation_rules").select("id, pipeline_id, stage_id, task_title, due_in_days, enabled, trigger_event, after_days, repeat_days").eq("company_id", company.id).order("created_at").returns<RuleRow[]>(),
    supabase
      .from("task_templates")
      .select("id, pipeline_id, title, active")
      .eq("company_id", company.id)
      .order("position")
      .order("title")
      .returns<TemplateRow[]>(),
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
      trigger: r.trigger_event,
      afterDays: r.after_days,
      repeatDays: r.repeat_days,
    }))
    .sort(
      (a, b) =>
        (pipelineOrder.get(a.pipelineId) ?? 0) - (pipelineOrder.get(b.pipelineId) ?? 0) ||
        (stageOrder.get(a.stageId) ?? 0) - (stageOrder.get(b.stageId) ?? 0) ||
        TRIGGER_ORDER[a.trigger] - TRIGGER_ORDER[b.trigger] ||
        a.dueInDays - b.dueInDays,
    );

  return (
    <>
      <PageHeader title="Automações" subtitle={`${company.name}: o que o CRM faz sozinho e as tarefas prontas da equipe`} />
      <div className="content grid gap-4">
        {rulesRes.error && <Notice tone="bad">Não foi possível carregar as regras. Recarregue a página.</Notice>}
        <RulesManager
          slug={company.slug}
          isLoc={company.slug === "locpress"}
          rules={rules}
          pipelines={pipelines}
          stages={stages.map((s) => ({ id: s.id, name: s.name, kind: s.kind, logistics: s.logistics, pipelineId: s.pipeline_id }))}
        />
        <TemplatesManager slug={company.slug} pipelines={pipelines} templates={templatesRes.data ?? []} loadError={!!templatesRes.error} />
      </div>
    </>
  );
}
