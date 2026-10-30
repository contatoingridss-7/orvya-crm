import type { Metadata } from "next";
import { PageHeader } from "@/components/app-shell/page-header";
import { Notice } from "@/components/ui/notice";
import { requireSettings } from "@/lib/auth/viewer";
import type { Pipeline, Stage } from "@/lib/crm/types";
import { createClient } from "@/lib/supabase/server";
import { parseHours } from "@/lib/whatsapp/after-hours";
import { AfterHoursManager } from "./after-hours-manager";
import { IgMenuManager, type IgMenuNumber } from "./ig-menu-manager";
import { IgRepliesManager, type IgReply } from "./ig-replies-manager";
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
  const { company } = await requireSettings((await params).empresa);
  const supabase = await createClient();

  const [pipelinesRes, stagesRes, rulesRes, templatesRes, igRepliesRes, igAccountRes, igMenuRes, numbersRes, afterHoursRes] = await Promise.all([
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
    supabase.from("ig_auto_replies").select("id, trigger, keywords, reply, active").eq("company_id", company.id).order("position").order("created_at").returns<IgReply[]>(),
    supabase.from("instagram_accounts").select("id").eq("company_id", company.id).eq("status", "connected").limit(1),
    supabase
      .from("ig_welcome_menu")
      .select("enabled, intro, options, link_reply, whatsapp_number_id")
      .eq("company_id", company.id)
      .maybeSingle<{ enabled: boolean; intro: string; options: string[]; link_reply: string; whatsapp_number_id: string | null }>(),
    supabase
      .from("whatsapp_numbers")
      .select("id, label, display_phone, status")
      .eq("company_id", company.id)
      .order("slot")
      .returns<{ id: string; label: string; display_phone: string | null; status: string }[]>(),
    supabase
      .from("whatsapp_after_hours")
      .select("enabled, hours, message")
      .eq("company_id", company.id)
      .maybeSingle<{ enabled: boolean; hours: unknown; message: string }>(),
  ]);
  const afterHours = afterHoursRes.data;
  const igMenu = igMenuRes.data;
  const menuNumbers: IgMenuNumber[] = (numbersRes.data ?? [])
    .filter((n) => n.status === "connected" && n.display_phone)
    .map((n) => ({ id: n.id, label: n.label, phone: n.display_phone! }));

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
        <AfterHoursManager
          slug={company.slug}
          companyName={company.name}
          settings={afterHours ? { enabled: afterHours.enabled, hours: parseHours(afterHours.hours), message: afterHours.message } : null}
          loadError={!!afterHoursRes.error}
        />
        <TemplatesManager slug={company.slug} pipelines={pipelines} templates={templatesRes.data ?? []} loadError={!!templatesRes.error} />
        <IgMenuManager
          slug={company.slug}
          menu={
            igMenu
              ? { enabled: igMenu.enabled, intro: igMenu.intro, options: igMenu.options, linkReply: igMenu.link_reply, whatsappNumberId: igMenu.whatsapp_number_id }
              : null
          }
          numbers={menuNumbers}
          loadError={!!igMenuRes.error}
        />
        <IgRepliesManager slug={company.slug} replies={igRepliesRes.data ?? []} connected={!!igAccountRes.data?.length} loadError={!!igRepliesRes.error} />
      </div>
    </>
  );
}
