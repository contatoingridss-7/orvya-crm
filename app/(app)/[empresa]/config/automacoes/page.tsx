import type { Metadata } from "next";
import { ComingSoon } from "@/components/app-shell/coming-soon";
import { PageHeader } from "@/components/app-shell/page-header";
import { requireRole } from "@/lib/auth/viewer";

export const metadata: Metadata = { title: "Automações" };

export default async function AutomacoesPage({ params }: { params: Promise<{ empresa: string }> }) {
  const { company } = await requireRole((await params).empresa, ["admin", "gestor"]);
  return (
    <>
      <PageHeader title="Automações" subtitle={`${company.name}: o que o CRM faz sozinho quando um lead muda de etapa`} />
      <div className="content">
        <ComingSoon phase="Fase 2">Regras por etapa que criam tarefas automaticamente.</ComingSoon>
      </div>
    </>
  );
}
