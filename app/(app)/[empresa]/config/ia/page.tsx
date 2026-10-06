import type { Metadata } from "next";
import { ComingSoon } from "@/components/app-shell/coming-soon";
import { PageHeader } from "@/components/app-shell/page-header";
import { requireRole } from "@/lib/auth/viewer";

export const metadata: Metadata = { title: "Agente de IA" };

export default async function IaPage({ params }: { params: Promise<{ empresa: string }> }) {
  const { company } = await requireRole((await params).empresa, ["admin", "gestor"]);
  return (
    <>
      <PageHeader title="Agente de IA" subtitle={`${company.name}: como o atendente virtual responde no WhatsApp`} />
      <div className="content">
        <ComingSoon phase="Fase 4">Ligar e desligar o agente, horário, instruções da empresa e teste com conversa simulada.</ComingSoon>
      </div>
    </>
  );
}
