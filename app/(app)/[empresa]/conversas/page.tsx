import type { Metadata } from "next";
import { PageHeader } from "@/components/app-shell/page-header";
import { Notice } from "@/components/ui/notice";
import { isManager, type MemberRole, SALES_ROLES } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/viewer";
import type { Person } from "@/lib/crm/types";
import { createClient } from "@/lib/supabase/server";
import { Inbox, type InboxConversation, type InboxTemplate } from "./inbox";

export const metadata: Metadata = { title: "Conversas" };

type ConvRow = {
  id: string;
  assigned_to: string | null;
  ai_enabled: boolean;
  needs_human: boolean;
  needs_human_reason: string | null;
  last_inbound_at: string | null;
  last_message_at: string | null;
  last_preview: string | null;
  last_direction: "in" | "out" | null;
  unread_count: number;
  lead_id: string | null;
  whatsapp_number_id: string | null;
  contacts: { name: string; phone_e164: string | null; org_name: string | null } | null;
  leads: { id: string; closed_at: string | null; stages: { name: string } | null; pipelines: { key: string; name: string } | null } | null;
};
type NumberRow = { id: string; label: string; display_phone: string | null; status: string };
type TemplateRow = { id: string; name: string; category: InboxTemplate["category"]; body: string; variables: string[] | null };
type MemberRow = { role: MemberRole; profiles: { id: string; full_name: string | null; email: string | null; active: boolean } | null };

export default async function ConversasPage({ params, searchParams }: { params: Promise<{ empresa: string }>; searchParams: Promise<{ c?: string }> }) {
  const { viewer, company } = await requireRole((await params).empresa, SALES_ROLES);
  const sp = await searchParams;
  const supabase = await createClient();

  const [convRes, numbersRes, membersRes, aiRes, templatesRes] = await Promise.all([
    // O RLS já filtra: vendedor vê as dele e as da fila; gestor/admin, todas.
    supabase
      .from("conversations")
      .select(
        "id, assigned_to, ai_enabled, needs_human, needs_human_reason, last_inbound_at, last_message_at, last_preview, last_direction, unread_count, lead_id, whatsapp_number_id, contacts(name, phone_e164, org_name), leads(id, closed_at, stages(name), pipelines(key, name))",
      )
      .eq("company_id", company.id)
      .eq("channel", "whatsapp")
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(300)
      .returns<ConvRow[]>(),
    supabase.from("whatsapp_numbers").select("id, label, display_phone, status").eq("company_id", company.id).order("slot").returns<NumberRow[]>(),
    supabase.from("memberships").select("role, profiles(id, full_name, email, active)").eq("company_id", company.id).returns<MemberRow[]>(),
    // Só gestor/admin leem a configuração da IA; para o vendedor fica "desligada" na tela.
    supabase.from("ai_settings").select("enabled").eq("company_id", company.id).maybeSingle<{ enabled: boolean }>(),
    // Modelos aprovados da empresa (membros leem pelo RLS) para enviar fora da janela de 24 h.
    supabase
      .from("message_templates")
      .select("id, name, category, body, variables")
      .eq("company_id", company.id)
      .eq("status", "approved")
      .order("name")
      .returns<TemplateRow[]>(),
  ]);

  const people: Person[] = (membersRes.data ?? [])
    .filter((m) => m.profiles)
    .map((m) => ({ id: m.profiles!.id, name: m.profiles!.full_name || m.profiles!.email || "Sem nome" }));
  if (!people.some((p) => p.id === viewer.id)) people.push({ id: viewer.id, name: viewer.fullName });

  const conversations: InboxConversation[] = (convRes.data ?? []).map((c) => ({
    id: c.id,
    assignedTo: c.assigned_to,
    aiEnabled: c.ai_enabled,
    needsHuman: c.needs_human,
    needsHumanReason: c.needs_human_reason,
    lastInboundAt: c.last_inbound_at,
    lastMessageAt: c.last_message_at,
    lastPreview: c.last_preview,
    lastDirection: c.last_direction,
    unread: c.unread_count,
    numberId: c.whatsapp_number_id,
    contactName: c.contacts?.name ?? "Sem nome",
    contactPhone: c.contacts?.phone_e164 ?? null,
    contactOrg: c.contacts?.org_name ?? null,
    lead: c.leads
      ? { id: c.leads.id, open: !c.leads.closed_at, stage: c.leads.stages?.name ?? null, pipelineKey: c.leads.pipelines?.key ?? null, pipelineName: c.leads.pipelines?.name ?? null }
      : null,
  }));

  return (
    <>
      <PageHeader title="Conversas" subtitle={`${company.name}: WhatsApp em tempo real`} />
      <div className="content grid gap-3">
        {convRes.error && <Notice tone="bad">Não foi possível carregar as conversas. Recarregue a página.</Notice>}
        <Inbox
          slug={company.slug}
          companyId={company.id}
          conversations={conversations}
          numbers={(numbersRes.data ?? []).map((n) => ({ id: n.id, label: n.label, phone: n.display_phone, connected: n.status === "connected" }))}
          people={people}
          viewerId={viewer.id}
          viewerName={viewer.fullName}
          templates={(templatesRes.data ?? []).map((t) => ({ id: t.id, name: t.name, category: t.category, body: t.body, variables: t.variables ?? [] }))}
          manager={isManager(company.role)}
          companyAi={aiRes.data?.enabled ?? false}
          initialId={sp.c ?? null}
        />
      </div>
    </>
  );
}
