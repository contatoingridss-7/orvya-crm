import type { Metadata } from "next";
import { PageHeader } from "@/components/app-shell/page-header";
import { Notice } from "@/components/ui/notice";
import { requireRole } from "@/lib/auth/viewer";
import { photoUrl } from "@/lib/catalog/photos";
import type { LogisticsStatus, StageLogistics } from "@/lib/crm/types";
import { createClient } from "@/lib/supabase/server";
import { ShipmentBoard, type Shipment } from "./shipment-board";

export const metadata: Metadata = { title: "Expedição" };

type OrderRow = {
  lead_id: string;
  kind: StageLogistics;
  pipeline_name: string;
  stage_name: string;
  contact_name: string;
  contact_phone: string | null;
  address: string | null;
  scheduled_at: string;
  status: LogisticsStatus;
  notes: string | null;
  delivered_at: string | null;
  owner_name: string | null;
  products: { name: string; code: string | null; quantity: number; mode: "venda" | "locacao"; photo: string | null }[];
};

export default async function ExpedicaoPage({ params }: { params: Promise<{ empresa: string }> }) {
  const { company } = await requireRole((await params).empresa, ["admin", "gestor", "logistica"]);
  const supabase = await createClient();

  // Função do banco: devolve só o necessário para separar, faturar e entregar (sem valores nem dados de saúde).
  const { data: rows, error } = await supabase.rpc("logistics_orders", { p_company: company.id });
  const data = rows as OrderRow[] | null;

  const shipments: Shipment[] = (data ?? []).map((r) => ({
    id: r.lead_id,
    kind: r.kind,
    pipelineName: r.pipeline_name,
    stageName: r.stage_name,
    contactName: r.contact_name,
    phone: r.contact_phone,
    address: r.address,
    scheduledAt: r.scheduled_at,
    status: r.status,
    notes: r.notes,
    deliveredAt: r.delivered_at,
    ownerName: r.owner_name,
    products: r.products.map((p) => ({ name: p.name, code: p.code, quantity: p.quantity, mode: p.mode, photo: photoUrl(p.photo) })),
  }));

  return (
    <>
      <PageHeader title="Expedição" subtitle={`${company.name}: separação, faturamento e entrega dos pedidos agendados`} />
      <div className="content grid gap-4">
        {error && <Notice tone="bad">Não foi possível carregar os pedidos. Recarregue a página.</Notice>}
        <ShipmentBoard slug={company.slug} shipments={shipments} />
      </div>
    </>
  );
}
