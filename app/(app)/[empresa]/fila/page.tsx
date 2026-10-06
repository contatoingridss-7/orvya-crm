import type { Metadata } from "next";
import { ComingSoon } from "@/components/app-shell/coming-soon";
import { PageHeader } from "@/components/app-shell/page-header";
import { requireRole } from "@/lib/auth/viewer";

export const metadata: Metadata = { title: "Precisa de mim" };

export default async function FilaPage({ params }: { params: Promise<{ empresa: string }> }) {
  const { company } = await requireRole((await params).empresa, ["admin", "gestor"]);
  return (
    <>
      <PageHeader title="Precisa de mim" subtitle={`${company.name}: conversas que a IA passou para a equipe e leads para reativar`} />
      <div className="content">
        <ComingSoon phase="Fase 3">Conversas que precisam da equipe e reativação de leads parados em lote.</ComingSoon>
      </div>
    </>
  );
}
