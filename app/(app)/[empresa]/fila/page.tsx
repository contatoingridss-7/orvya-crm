import type { Metadata } from "next";
import { PageHeader } from "@/components/app-shell/page-header";
import { AutoRefresh } from "@/components/auto-refresh";
import { ESCALATE_HOURS, WAIT_MINUTES } from "@/lib/crm/attention";
import { TASK_SELECT, toTask, type TaskRow } from "@/lib/crm/tasks";
import { Notice } from "@/components/ui/notice";
import { Panel } from "@/components/ui/panel";
import type { MemberRole } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/viewer";
import { daysSince } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import type { TemplateCategory } from "@/lib/whatsapp/pricing";
import { AttentionList, type AttentionItem, type Person } from "./attention-list";
import { LateTasks } from "./late-tasks";
import { ReactivatePanel, type StaleLead, type ReactivateTemplate } from "./reactivate";
import { SendQueue, type QueueRow } from "./send-queue";

export const metadata: Metadata = { title: "Precisa de mim" };

/** Menor filtro de "parado" (chips 2, 5, 7 e 14 dias). */
const MIN_STALE_DAYS = 2;

type ConvRow = {
  id: string;
  assigned_to: string | null;
  needs_human_reason: string | null;
  ai_summary: string | null;
  last_inbound_at: string | null;
  last_message_at: string | null;
  last_preview: string | null;
  contacts: { name: string } | null;
  leads: { score: number; owner_id: string | null } | null;
};
type MemberRow = { role: MemberRole; profiles: { id: string; full_name: string | null; email: string | null; active: boolean } | null };
type LeadRow = {
  id: string;
  owner_id: string | null;
  contact_id: string;
  score: number;
  temperature: "quente" | "morno" | "frio";
  last_contact_at: string | null;
  created_at: string;
  contacts: { name: string } | null;
  stages: { name: string } | null;
  pipelines: { name: string } | null;
  lead_products: { products: { name: string } | null }[] | null;
};
type WaConvRow = { id: string; contact_id: string; lead_id: string | null; needs_human: boolean; last_message_at: string | null };
type TemplateRow = { id: string; name: string; category: TemplateCategory; body: string; variables: string[] | null };
type QueueDbRow = {
  id: string;
  status: QueueRow["status"];
  scheduled_at: string;
  error: string | null;
  lead_id: string | null;
  conversation_id: string;
  conversations: { contacts: { name: string } | null } | null;
  message_templates: { name: string } | null;
};

const CONV_SELECT = "id, assigned_to, needs_human_reason, ai_summary, last_inbound_at, last_message_at, last_preview, contacts(name), leads(score, owner_id)";

export default async function FilaPage({ params }: { params: Promise<{ empresa: string }> }) {
  const { viewer, company } = await requireRole((await params).empresa, ["admin", "gestor"]);
  const supabase = await createClient();
  const now = Date.now();
  const waitCutoff = new Date(now - WAIT_MINUTES * 60_000).toISOString();
  const staleCutoff = new Date(now - MIN_STALE_DAYS * 86_400_000).toISOString();

  // Tudo pelo cliente autenticado: o RLS mostra ao gestor/admin só a empresa dele.
  const [needsRes, waitingRes, membersRes, leadsRes, waConvRes, templatesRes, queueRes, lateRes] = await Promise.all([
    supabase.from("conversations").select(CONV_SELECT).eq("company_id", company.id).eq("needs_human", true).limit(200).returns<ConvRow[]>(),
    supabase
      .from("conversations")
      .select(CONV_SELECT)
      .eq("company_id", company.id)
      .eq("needs_human", false)
      .eq("last_direction", "in")
      .lt("last_inbound_at", waitCutoff)
      .order("last_inbound_at", { ascending: true })
      .limit(100)
      .returns<ConvRow[]>(),
    supabase.from("memberships").select("role, profiles(id, full_name, email, active)").eq("company_id", company.id).returns<MemberRow[]>(),
    supabase
      .from("leads")
      .select(
        "id, owner_id, contact_id, score, temperature, last_contact_at, created_at, contacts(name), stages(name), pipelines(name), lead_products(products(name))",
      )
      .eq("company_id", company.id)
      .is("closed_at", null)
      .or(`last_contact_at.lt."${staleCutoff}",and(last_contact_at.is.null,created_at.lt."${staleCutoff}")`)
      .order("last_contact_at", { ascending: true, nullsFirst: true })
      .limit(500)
      .returns<LeadRow[]>(),
    // Conversas de WhatsApp com número conectado (só elas podem receber o modelo).
    supabase
      .from("conversations")
      .select("id, contact_id, lead_id, needs_human, last_message_at, whatsapp_numbers!inner(status)")
      .eq("company_id", company.id)
      .eq("channel", "whatsapp")
      .eq("whatsapp_numbers.status", "connected")
      .limit(3000)
      .returns<WaConvRow[]>(),
    supabase
      .from("message_templates")
      .select("id, name, category, body, variables")
      .eq("company_id", company.id)
      .eq("status", "approved")
      .order("name")
      .returns<TemplateRow[]>(),
    supabase
      .from("outbound_queue")
      .select("id, status, scheduled_at, error, lead_id, conversation_id, conversations(contacts(name)), message_templates(name)")
      .eq("company_id", company.id)
      .or(`status.in.(pendente,enviando),created_at.gte."${staleCutoff}"`)
      .order("scheduled_at", { ascending: true })
      .limit(500)
      .returns<QueueDbRow[]>(),
    // Tarefas vencidas há mais de 1 dia: o gestor cobra o responsável.
    supabase
      .from("tasks")
      .select(TASK_SELECT)
      .eq("company_id", company.id)
      .is("done_at", null)
      .lt("due_at", new Date(now - ESCALATE_HOURS * 3600_000).toISOString())
      .order("due_at")
      .limit(100)
      .returns<TaskRow[]>(),
  ]);

  const people: Person[] = (membersRes.data ?? [])
    .filter((m) => m.profiles?.active)
    .map((m) => ({ id: m.profiles!.id, name: m.profiles!.full_name || m.profiles!.email || "Sem nome", role: m.role }));
  if (!people.some((p) => p.id === viewer.id)) people.unshift({ id: viewer.id, name: viewer.fullName, role: "gestor" });
  const nameOf = new Map(people.map((p) => [p.id, p.name]));
  for (const m of membersRes.data ?? []) if (m.profiles && !nameOf.has(m.profiles.id)) nameOf.set(m.profiles.id, m.profiles.full_name || "Ex-integrante");

  const toItem = (c: ConvRow): AttentionItem => ({
    id: c.id,
    contactName: c.contacts?.name ?? "Sem nome",
    reason: c.needs_human_reason,
    summary: c.ai_summary,
    preview: c.last_preview,
    score: c.leads?.score ?? null,
    waitingSince: c.last_inbound_at ?? c.last_message_at,
    assignedTo: c.assigned_to,
    assignedName: c.assigned_to ? (nameOf.get(c.assigned_to) ?? "Equipe") : null,
  });
  const time = (s: string | null) => (s ? new Date(s).getTime() : Number.MAX_SAFE_INTEGER);
  const needs = (needsRes.data ?? [])
    .slice()
    .sort((a, b) => (b.leads?.score ?? 0) - (a.leads?.score ?? 0) || time(a.last_inbound_at) - time(b.last_inbound_at))
    .map(toItem);
  const waiting = (waitingRes.data ?? []).map(toItem);

  // Leads parados: abertos, com conversa de WhatsApp em número conectado e sem pedido de atendimento pendente.
  const convByContact = new Map<string, WaConvRow[]>();
  for (const c of waConvRes.data ?? []) convByContact.set(c.contact_id, [...(convByContact.get(c.contact_id) ?? []), c]);
  const queue: QueueRow[] = (queueRes.data ?? []).map((q) => ({
    id: q.id,
    status: q.status,
    scheduledAt: q.scheduled_at,
    error: q.error,
    contactName: q.conversations?.contacts?.name ?? "Contato",
    templateName: q.message_templates?.name ?? "modelo",
    conversationId: q.conversation_id,
  }));
  const queuedLeads = new Set((queueRes.data ?? []).filter((q) => q.status === "pendente" || q.status === "enviando").map((q) => q.lead_id));

  const stale: StaleLead[] = [];
  for (const l of leadsRes.data ?? []) {
    const options = convByContact.get(l.contact_id);
    if (!options?.length) continue;
    const conv =
      options.find((c) => c.lead_id === l.id) ??
      options.slice().sort((a, b) => (b.last_message_at ?? "").localeCompare(a.last_message_at ?? ""))[0]!;
    if (conv.needs_human) continue;
    const ownerName = l.owner_id ? (nameOf.get(l.owner_id) ?? null) : null;
    stale.push({
      leadId: l.id,
      conversationId: conv.id,
      name: l.contacts?.name ?? "Sem nome",
      stage: l.stages?.name ?? "",
      pipeline: l.pipelines?.name ?? "",
      ownerName,
      sellerName: ownerName ?? viewer.fullName,
      productName: l.lead_products?.find((p) => p.products?.name)?.products?.name ?? null,
      days: daysSince(l.last_contact_at ?? l.created_at),
      lastContact: l.last_contact_at ?? l.created_at,
      temperature: l.temperature,
      queued: queuedLeads.has(l.id),
    });
  }
  stale.sort((a, b) => b.days - a.days);

  const templates: ReactivateTemplate[] = (templatesRes.data ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    category: t.category,
    body: t.body,
    variables: t.variables ?? [],
  }));

  const loadError = needsRes.error || waitingRes.error || membersRes.error;
  const reactError = leadsRes.error || waConvRes.error || templatesRes.error;

  return (
    <>
      <PageHeader title="Precisa de mim" subtitle={`${company.name}: conversas que esperam a equipe e leads para reativar`} />
      <div className="content grid gap-4">
        {/* Novos clientes passam dos 5 minutos a qualquer momento: a lista se atualiza sozinha. */}
        <AutoRefresh seconds={30} />
        {loadError && <Notice tone="bad">Parte das conversas não carregou. Recarregue a página.</Notice>}

        <div className="grid items-start gap-4 xl:grid-cols-2">
          <div className="grid content-start gap-4">
            <Panel title="Conversas esperando a equipe" subtitle="Pedidos de atendimento, ordenados por score e tempo de espera">
              <AttentionList slug={company.slug} items={needs} people={people} viewerId={viewer.id} emptyText="Nenhuma conversa esperando a equipe." />
            </Panel>
            <Panel title="Sem resposta da equipe" subtitle={`A última mensagem é do cliente, há mais de ${WAIT_MINUTES} minutos. Quem espera mais aparece primeiro.`}>
              <AttentionList slug={company.slug} items={waiting} people={people} viewerId={viewer.id} emptyText="Todos os clientes foram respondidos." />
            </Panel>
          </div>

          <div className="grid content-start gap-4">
            <Panel title="Tarefas atrasadas da equipe" subtitle="Vencidas há mais de 1 dia, com o nome do responsável. As mais antigas primeiro.">
              {lateRes.error ? (
                <Notice tone="bad">Não foi possível carregar as tarefas atrasadas.</Notice>
              ) : (
                <LateTasks slug={company.slug} tasks={(lateRes.data ?? []).map(toTask)} viewerId={viewer.id} />
              )}
            </Panel>
            <Panel title="Reativar leads parados">
              {reactError ? (
                <Notice tone="bad">Não foi possível carregar os leads parados. Recarregue a página.</Notice>
              ) : (
                <ReactivatePanel slug={company.slug} leads={stale} templates={templates} />
              )}
            </Panel>
            <Panel title="Fila de envios" subtitle="Últimos 2 dias. As mensagens saem uma a uma, com 2 a 6 minutos entre elas.">
              {queueRes.error ? (
                <Notice tone="bad">Não foi possível carregar a fila de envios. Recarregue a página.</Notice>
              ) : (
                <SendQueue slug={company.slug} rows={queue} />
              )}
            </Panel>
          </div>
        </div>
      </div>
    </>
  );
}
