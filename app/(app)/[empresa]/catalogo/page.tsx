import type { Metadata } from "next";
import { ComingSoon } from "@/components/app-shell/coming-soon";
import { PageHeader } from "@/components/app-shell/page-header";
import { requireCompany } from "@/lib/auth/viewer";

export const metadata: Metadata = { title: "Catálogo" };

export default async function CatalogoPage({ params }: { params: Promise<{ empresa: string }> }) {
  const { company } = await requireCompany((await params).empresa);
  const sub = company.slug === "locpress" ? "equipamentos para venda e locação" : "produtos e preços que o agente pode informar";
  return (
    <>
      <PageHeader title="Catálogo" subtitle={`${company.name}: ${sub}`} />
      <div className="content">
        <ComingSoon phase="Fase 2">Produtos, preços, estoque e importação por planilha.</ComingSoon>
      </div>
    </>
  );
}
