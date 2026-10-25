import type { Metadata } from "next";
import { PageHeader } from "@/components/app-shell/page-header";
import { Notice } from "@/components/ui/notice";
import { requireRole } from "@/lib/auth/viewer";
import { resolvePeriod } from "@/lib/crm/period";
import type { Pipeline } from "@/lib/crm/types";
import { publicEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { whatsappEnvStatus } from "@/lib/whatsapp/config";
import { ChannelsManager, type NumberSlot } from "./channels-manager";
import { InstagramPanel, type IgAccountItem } from "./instagram-panel";
import type { TemplateItem } from "./templates-panel";

export const metadata: Metadata = { title: "Canais e integrações" };

type NumberRow = {
  id: string;
  slot: 1 | 2;
  label: string;
  display_phone: string | null;
  phone_number_id: string | null;
  waba_id: string | null;
  default_pipeline_id: string | null;
  status: NumberSlot["status"];
  quality_rating: string | null;
  connected_at: string | null;
};
type TemplateRow = {
  id: string;
  name: string;
  category: TemplateItem["category"];
  status: TemplateItem["status"];
  body: string;
  variables: string[] | null;
  rejected_reason: string | null;
  updated_at: string;
};
type ConvRow = { whatsapp_number_id: string | null; last_inbound_at: string | null; leads: { closed_at: string | null } | null };
type IgRow = {
  id: string;
  username: string | null;
  name: string | null;
  status: IgAccountItem["status"];
  last_error: string | null;
  default_pipeline_id: string | null;
  connected_at: string;
};

export default async function CanaisPage({ params }: { params: Promise<{ empresa: string }> }) {
  const { company } = await requireRole((await params).empresa, ["admin", "gestor"]);
  const canEdit = company.role === "admin";
  const supabase = await createClient();
  const month = resolvePeriod("mes");

  const [numbersRes, pipelinesRes, convRes, templatesRes, igRes, igConvRes] = await Promise.all([
    supabase
      .from("whatsapp_numbers")
      .select("id, slot, label, display_phone, phone_number_id, waba_id, default_pipeline_id, status, quality_rating, connected_at")
      .eq("company_id", company.id)
      .order("slot")
      .returns<NumberRow[]>(),
    supabase.from("pipelines").select("id, key, name, hint").eq("company_id", company.id).order("position").returns<Pipeline[]>(),
    supabase.from("conversations").select("whatsapp_number_id, last_inbound_at, leads(closed_at)").eq("company_id", company.id).eq("channel", "whatsapp").returns<ConvRow[]>(),
    supabase
      .from("message_templates")
      .select("id, name, category, status, body, variables, rejected_reason, updated_at")
      .eq("company_id", company.id)
      .order("name")
      .returns<TemplateRow[]>(),
    // Instagram: a conta conectada (ou a última desconectada).
    supabase
      .from("instagram_accounts")
      .select("id, username, name, status, last_error, default_pipeline_id, connected_at")
      .eq("company_id", company.id)
      .order("connected_at", { ascending: false })
      .limit(1)
      .returns<IgRow[]>(),
    supabase
      .from("conversations")
      .select("id", { count: "exact", head: true })
      .eq("company_id", company.id)
      .eq("channel", "instagram")
      .gte("last_inbound_at", month.start.toISOString()),
  ]);
  const ig = igRes.data?.[0] ?? null;

  const convs = convRes.data ?? [];
  const slots: NumberSlot[] = (numbersRes.data ?? []).map((n) => {
    const mine = convs.filter((c) => c.whatsapp_number_id === n.id);
    return {
      slot: n.slot,
      label: n.label,
      displayPhone: n.display_phone,
      phoneNumberId: n.phone_number_id,
      wabaId: n.waba_id,
      defaultPipelineId: n.default_pipeline_id,
      status: n.status,
      qualityRating: n.quality_rating,
      connectedAt: n.connected_at,
      conversationsThisMonth: mine.filter((c) => c.last_inbound_at && new Date(c.last_inbound_at) >= month.start).length,
      openLeads: mine.filter((c) => c.leads && !c.leads.closed_at).length,
    };
  });

  return (
    <>
      <PageHeader title="Canais e integrações" subtitle={`${company.name}: números de WhatsApp, modelos de mensagem, Instagram e site`} />
      <div className="content grid gap-4">
        {numbersRes.error && <Notice tone="bad">Não foi possível carregar os números. Recarregue a página.</Notice>}
        {!canEdit && <Notice>Você pode ver os números. A conexão é feita pelo administrador.</Notice>}
        <ChannelsManager
          slug={company.slug}
          companyName={company.name}
          slots={slots}
          pipelines={pipelines(pipelinesRes.data)}
          canEdit={canEdit}
          webhookUrl={`${publicEnv.NEXT_PUBLIC_APP_URL}/api/webhooks/whatsapp`}
          env={canEdit ? whatsappEnvStatus() : null}
          templates={(templatesRes.data ?? []).map((t) => ({
            id: t.id,
            name: t.name,
            category: t.category,
            status: t.status,
            body: t.body,
            variables: t.variables ?? [],
            rejectedReason: t.rejected_reason,
            updatedAt: t.updated_at,
          }))}
          templatesError={!!templatesRes.error}
        />
        <InstagramPanel
          slug={company.slug}
          companyName={company.name}
          account={
            ig
              ? {
                  id: ig.id,
                  username: ig.username,
                  name: ig.name,
                  status: ig.status,
                  lastError: ig.last_error,
                  defaultPipelineId: ig.default_pipeline_id,
                  connectedAt: ig.connected_at,
                  conversationsThisMonth: igConvRes.count ?? 0,
                }
              : null
          }
          pipelines={pipelines(pipelinesRes.data)}
          canEdit={canEdit}
          webhookUrl={`${publicEnv.NEXT_PUBLIC_APP_URL}/api/webhooks/whatsapp`}
        />
      </div>
    </>
  );
}

function pipelines(rows: Pipeline[] | null) {
  return (rows ?? []).map((p) => ({ id: p.id, name: p.name }));
}
