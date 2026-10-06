// Tipos do funil (kanban) e do detalhe do lead.

export type StageKind = "open" | "won" | "lost";
export type Temperature = "quente" | "morno" | "frio";
export type CustomerType = "B2C" | "B2B";

export type Pipeline = { id: string; key: string; name: string; hint: string | null };
export type Stage = { id: string; key: string; name: string; kind: StageKind; position: number };
export type CustomField = {
  id: string;
  key: string;
  label: string;
  type: "text" | "number" | "date" | "select";
  options: string[] | null;
  fullWidth: boolean;
};
export type Option = { id: string; name: string };
export type Person = { id: string; name: string };

export type CatalogOption = {
  id: string;
  code: string | null;
  name: string;
  salePrice: number | null;
  rentPrice: number | null;
  isRental: boolean;
  requiresHuman: boolean;
};

export type BoardLead = {
  id: string;
  stageId: string;
  pipelineId: string;
  ownerId: string | null;
  sourceId: string | null;
  value: number;
  temperature: Temperature;
  score: number;
  custom: Record<string, string>;
  lostReason: string | null;
  closedAt: string | null;
  lastContactAt: string | null;
  createdAt: string;
  contact: { id: string; name: string; phone: string | null; org: string | null; email: string | null; type: CustomerType };
  aiEnabled: boolean | null; // null = ainda sem conversa
  needsHuman: boolean;
  overdueTask: boolean;
};

export const LEAD_SELECT =
  "id, stage_id, pipeline_id, owner_id, source_id, value, temperature, score, custom, lost_reason, closed_at, last_contact_at, created_at, contacts(id, name, phone_e164, org_name, email, customer_type), conversations(ai_enabled, needs_human)";

export type LeadRow = {
  id: string;
  stage_id: string;
  pipeline_id: string;
  owner_id: string | null;
  source_id: string | null;
  value: number | string;
  temperature: Temperature;
  score: number;
  custom: Record<string, unknown> | null;
  lost_reason: string | null;
  closed_at: string | null;
  last_contact_at: string | null;
  created_at: string;
  contacts: { id: string; name: string; phone_e164: string | null; org_name: string | null; email: string | null; customer_type: CustomerType } | null;
  conversations: { ai_enabled: boolean; needs_human: boolean }[] | null;
};

export function toBoardLead(r: LeadRow, overdue: Set<string>): BoardLead {
  const conv = r.conversations?.[0] ?? null;
  return {
    id: r.id,
    stageId: r.stage_id,
    pipelineId: r.pipeline_id,
    ownerId: r.owner_id,
    sourceId: r.source_id,
    value: Number(r.value),
    temperature: r.temperature,
    score: r.score,
    custom: Object.fromEntries(Object.entries(r.custom ?? {}).map(([k, v]) => [k, v == null ? "" : String(v)])),
    lostReason: r.lost_reason,
    closedAt: r.closed_at,
    lastContactAt: r.last_contact_at,
    createdAt: r.created_at,
    contact: {
      id: r.contacts?.id ?? "",
      name: r.contacts?.name ?? "Sem nome",
      phone: r.contacts?.phone_e164 ?? null,
      org: r.contacts?.org_name ?? null,
      email: r.contacts?.email ?? null,
      type: r.contacts?.customer_type ?? "B2C",
    },
    aiEnabled: conv ? conv.ai_enabled : null,
    needsHuman: conv?.needs_human ?? false,
    overdueTask: overdue.has(r.id),
  };
}

export const TEMPERATURE_LABEL: Record<Temperature, string> = { quente: "Quente", morno: "Morno", frio: "Frio" };

// Detalhe do lead (carregado ao abrir o painel)
export type LeadActivity = { id: string; kind: string; body: string; userName: string | null; createdAt: string };
export type LeadTask = import("./tasks").TaskItem;
export type LeadProduct = { productId: string; name: string; code: string | null; mode: "venda" | "locacao"; quantity: number; price: number | null; requiresHuman: boolean };
export type LeadDetail = { activities: LeadActivity[]; tasks: LeadTask[]; products: LeadProduct[] };
