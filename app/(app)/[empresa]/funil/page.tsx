import type { Metadata } from "next";
import { ComingSoon } from "@/components/app-shell/coming-soon";
import { PageHeader } from "@/components/app-shell/page-header";
import { requireCompany } from "@/lib/auth/viewer";

export const metadata: Metadata = { title: "Funil" };

export default async function FunilPage({ params }: { params: Promise<{ empresa: string }> }) {
  const { company } = await requireCompany((await params).empresa);
  const seller = company.role === "vendedor";
  return (
    <>
      <PageHeader title={seller ? "Meu funil" : "Funil"} subtitle={`${company.name}: arraste os cards para mudar de etapa`} />
      <div className="content">
        <ComingSoon phase="Fase 2">Kanban por funil, detalhe do lead, novo lead e motivo de perda.</ComingSoon>
      </div>
    </>
  );
}
