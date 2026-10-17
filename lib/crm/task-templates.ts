import type { SupabaseClient } from "@supabase/supabase-js";
import type { TaskTemplate } from "./tasks";

type Row = { id: string; pipeline_id: string | null; title: string };

/** Tarefas prontas ativas da empresa, na ordem definida em Automações. */
export async function loadTaskTemplates(supabase: SupabaseClient, companyId: string): Promise<TaskTemplate[]> {
  const { data } = await supabase
    .from("task_templates")
    .select("id, pipeline_id, title")
    .eq("company_id", companyId)
    .eq("active", true)
    .order("position")
    .order("title")
    .returns<Row[]>();
  return (data ?? []).map((r) => ({ id: r.id, pipelineId: r.pipeline_id, title: r.title }));
}
