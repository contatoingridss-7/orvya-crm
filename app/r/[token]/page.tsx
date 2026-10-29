import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BrandMark, Signature } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";
import { TrafficReportView } from "@/components/traffic-report-view";
import type { ReportRow } from "@/lib/ads/traffic-report";
import { formatDateTime } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = { title: "Relatório de tráfego", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const TOKEN = /^[0-9a-f]{64}$/;

/**
 * Relatório aberto pelo cliente, sem login. Lido no servidor pelo token do link e só depois de
 * liberado pela gestora. Mostra métricas de anúncio e atendimento: nenhum dado de conversa ou de saúde.
 */
export default async function PublicReportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!TOKEN.test(token)) notFound();
  const { data: report } = await createAdminClient()
    .from("traffic_reports")
    .select("kind, data, notes_done, notes_next, hidden_alerts, released_at")
    .eq("share_token", token)
    .eq("status", "liberado")
    .maybeSingle<Pick<ReportRow, "kind" | "data" | "notes_done" | "notes_next" | "hidden_alerts" | "released_at">>();
  if (!report) notFound();

  return (
    <div className="min-h-dvh px-4 pt-6 pb-12 sm:px-7">
      <header className="mx-auto flex w-full max-w-[860px] items-center gap-3">
        <BrandMark size={26} />
        <div className="flex-1" />
        <ThemeToggle />
      </header>
      <main className="mx-auto mt-6 w-full max-w-[860px]">
        <TrafficReportView kind={report.kind} data={report.data} notesDone={report.notes_done} notesNext={report.notes_next} hiddenAlerts={report.hidden_alerts} />
        <footer className="mt-8 grid gap-2 text-[12px] text-muted">
          <p className="m-0">
            Números da Meta e do atendimento{report.released_at ? `, conferidos em ${formatDateTime(report.released_at)}` : ""}. Conversas iniciadas e custos são os informados pela Meta;
            contatos e vendas são os registrados pela equipe.
          </p>
          <Signature />
        </footer>
      </main>
    </div>
  );
}
