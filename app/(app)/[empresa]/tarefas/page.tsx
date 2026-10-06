import type { Metadata } from "next";
import { ComingSoon } from "@/components/app-shell/coming-soon";
import { PageHeader } from "@/components/app-shell/page-header";
import { requireCompany } from "@/lib/auth/viewer";

export const metadata: Metadata = { title: "Tarefas" };

export default async function TarefasPage({ params }: { params: Promise<{ empresa: string }> }) {
  const { company } = await requireCompany((await params).empresa);
  return (
    <>
      <PageHeader title="Tarefas" subtitle={`${company.name}: próximos passos da equipe`} />
      <div className="content">
        <ComingSoon phase="Fase 2">Tarefas atrasadas, de hoje e dos próximos dias, incluindo as criadas pelas automações.</ComingSoon>
      </div>
    </>
  );
}
