import type { Metadata } from "next";
import { ComingSoon } from "@/components/app-shell/coming-soon";
import { PageHeader } from "@/components/app-shell/page-header";
import { requireRole } from "@/lib/auth/viewer";

export const metadata: Metadata = { title: "Painel" };

export default async function PainelPage({ params }: { params: Promise<{ empresa: string }> }) {
  const { company } = await requireRole((await params).empresa, ["admin", "gestor"]);
  return (
    <>
      <PageHeader title="Painel" subtitle={`${company.name}: como está a operação comercial hoje`} />
      <div className="content">
        <ComingSoon phase="Fase 2">Indicadores, funil por etapa, origem dos leads e contratos vencendo aparecem aqui.</ComingSoon>
      </div>
    </>
  );
}
