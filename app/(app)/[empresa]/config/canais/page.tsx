import type { Metadata } from "next";
import { ComingSoon } from "@/components/app-shell/coming-soon";
import { PageHeader } from "@/components/app-shell/page-header";
import { requireRole } from "@/lib/auth/viewer";

export const metadata: Metadata = { title: "Canais e integrações" };

export default async function CanaisPage({ params }: { params: Promise<{ empresa: string }> }) {
  const { company } = await requireRole((await params).empresa, ["admin", "gestor"]);
  return (
    <>
      <PageHeader title="Canais e integrações" subtitle={`${company.name}: números de WhatsApp, modelos de mensagem, anúncios e site`} />
      <div className="content">
        <ComingSoon phase="Fase 3">Conexão dos números de WhatsApp pela API oficial e modelos de mensagem.</ComingSoon>
      </div>
    </>
  );
}
