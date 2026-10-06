import type { Metadata } from "next";
import { subDays } from "date-fns";
import { PageHeader } from "@/components/app-shell/page-header";
import { Notice } from "@/components/ui/notice";
import { isManager, type MemberRole } from "@/lib/auth/roles";
import { requireCompany } from "@/lib/auth/viewer";
import {
  LEAD_SELECT,
  toBoardLead,
  type CatalogOption,
  type CustomField,
  type LeadRow,
  type Option,
  type Person,
  type Pipeline,
  type Stage,
} from "@/lib/crm/types";
import { daysUntil } from "@/lib/crm/rentals";
import { createClient } from "@/lib/supabase/server";
import { Board } from "./board";

export const metadata: Metadata = { title: "Funil" };

// Ganhos e perdidos antigos saem do quadro para ele não crescer sem fim.
const CLOSED_WINDOW_DAYS = 60;

type CustomFieldRow = { id: string; key: string; label: string; field_type: CustomField["type"]; options: string[] | null; full_width: boolean };
type MemberRow = { role: MemberRole; profiles: { id: string; full_name: string | null; email: string | null; active: boolean } | null };
type ProductRow = {
  id: string;
  code: string | null;
  name: string;
  sale_price: string | number | null;
  rent_price_month: string | number | null;
  is_rental: boolean;
  requires_human: boolean;
};

export default async function FunilPage({
  params,
  searchParams,
}: {
  params: Promise<{ empresa: string }>;
  searchParams: Promise<{ funil?: string; lead?: string }>;
}) {
  const { viewer, company } = await requireCompany((await params).empresa);
  const sp = await searchParams;
  const seller = company.role === "vendedor";
  const supabase = await createClient();

  const { data: pipelineRows } = await supabase
    .from("pipelines")
    .select("id, key, name, hint")
    .eq("company_id", company.id)
    .order("position")
    .returns<Pipeline[]>();
  const pipelines = pipelineRows ?? [];
  const current = pipelines.find((p) => p.key === sp.funil) ?? pipelines[0];

  const header = (
    <PageHeader title={seller ? "Meu funil" : "Funil"} subtitle={`${company.name}: arraste os cards para mudar de etapa`} />
  );
  if (!current) {
    return (
      <>
        {header}
        <div className="content">
          <Notice tone="warn">Nenhum funil cadastrado para esta empresa.</Notice>
        </div>
      </>
    );
  }

  const closedSince = subDays(new Date(), CLOSED_WINDOW_DAYS).toISOString();
  const [stagesRes, leadsRes, fieldsRes, sourcesRes, reasonsRes, membersRes, productsRes, overdueRes, contractsRes] = await Promise.all([
    supabase.from("stages").select("id, key, name, kind, position").eq("pipeline_id", current.id).order("position").returns<Stage[]>(),
    supabase
      .from("leads")
      .select(LEAD_SELECT)
      .eq("company_id", company.id)
      .eq("pipeline_id", current.id)
      .or(`closed_at.is.null,closed_at.gte."${closedSince}"`)
      .order("updated_at", { ascending: false })
      .returns<LeadRow[]>(),
    supabase
      .from("custom_fields")
      .select("id, key, label, field_type, options, full_width")
      .eq("pipeline_id", current.id)
      .order("position")
      .returns<CustomFieldRow[]>(),
    supabase.from("lead_sources").select("id, name").eq("company_id", company.id).order("position").returns<Option[]>(),
    supabase.from("lost_reasons").select("id, name").eq("company_id", company.id).order("position").returns<Option[]>(),
    supabase.from("memberships").select("role, profiles(id, full_name, email, active)").eq("company_id", company.id).returns<MemberRow[]>(),
    supabase
      .from("products")
      .select("id, code, name, sale_price, rent_price_month, is_rental, requires_human")
      .eq("company_id", company.id)
      .eq("active", true)
      .order("name")
      .returns<ProductRow[]>(),
    supabase
      .from("tasks")
      .select("lead_id")
      .eq("company_id", company.id)
      .is("done_at", null)
      .lt("due_at", new Date().toISOString())
      .not("lead_id", "is", null)
      .returns<{ lead_id: string }[]>(),
    supabase
      .from("rental_contracts")
      .select("lead_id, end_date")
      .eq("company_id", company.id)
      .eq("status", "ativo")
      .returns<{ lead_id: string; end_date: string }[]>(),
  ]);

  const overdue = new Set((overdueRes.data ?? []).map((t) => t.lead_id));
  // Por lead, o contrato ativo que vence primeiro.
  const rentalDays = new Map<string, number>();
  for (const c of contractsRes.data ?? []) {
    const d = daysUntil(c.end_date);
    if (!rentalDays.has(c.lead_id) || d < rentalDays.get(c.lead_id)!) rentalDays.set(c.lead_id, d);
  }
  const leads = (leadsRes.data ?? []).map((r) => toBoardLead(r, overdue, rentalDays));

  const people: Person[] = (membersRes.data ?? [])
    .filter((m) => m.profiles?.active)
    .map((m) => ({ id: m.profiles!.id, name: m.profiles!.full_name || m.profiles!.email || "Sem nome" }));
  // Administrador também pode ser responsável por leads.
  if (viewer.isAdmin && !people.some((p) => p.id === viewer.id)) people.push({ id: viewer.id, name: viewer.fullName });
  people.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  const catalog: CatalogOption[] = (productsRes.data ?? []).map((p) => ({
    id: p.id,
    code: p.code,
    name: p.name,
    salePrice: p.sale_price === null ? null : Number(p.sale_price),
    rentPrice: p.rent_price_month === null ? null : Number(p.rent_price_month),
    isRental: p.is_rental,
    requiresHuman: p.requires_human,
  }));

  const fields: CustomField[] = (fieldsRes.data ?? []).map((f) => ({
    id: f.id,
    key: f.key,
    label: f.label,
    type: f.field_type,
    options: f.options,
    fullWidth: f.full_width,
  }));

  return (
    <>
      {header}
      <div className="content grid gap-3.5">
        {leadsRes.error && <Notice tone="bad">Não foi possível carregar os leads. Recarregue a página.</Notice>}
        <Board
          key={current.id}
          slug={company.slug}
          companyName={company.name}
          pipelines={pipelines}
          pipeline={current}
          stages={stagesRes.data ?? []}
          leads={leads}
          fields={fields}
          sources={sourcesRes.data ?? []}
          lostReasons={reasonsRes.data ?? []}
          people={people}
          catalog={catalog}
          viewerId={viewer.id}
          manager={isManager(company.role)}
          hasRentals={company.slug === "locpress"}
          initialLeadId={sp.lead ?? null}
          closedWindowDays={CLOSED_WINDOW_DAYS}
        />
      </div>
    </>
  );
}
