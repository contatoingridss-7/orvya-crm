import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/app-shell/page-header";
import { TrafficReportView } from "@/components/traffic-report-view";
import { reportPeriodText, whatsappText, type ReportRow } from "@/lib/ads/traffic-report";
import { requireRole } from "@/lib/auth/viewer";
import { publicEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { ReportEditor } from "./report-editor";

export const metadata: Metadata = { title: "Relatório de tráfego" };

/** Revisão do relatório: a gestora escreve as observações, tira alertas e libera o link para o cliente. */
export default async function ReportPage({ params }: { params: Promise<{ empresa: string; id: string }> }) {
  const { empresa, id } = await params;
  const { company } = await requireRole(empresa, ["admin"]);
  const supabase = await createClient();
  const { data: report } = await supabase.from("traffic_reports").select("*").eq("id", id).eq("company_id", company.id).maybeSingle<ReportRow>();
  if (!report) notFound();
  const url = `${publicEnv.NEXT_PUBLIC_APP_URL}/r/${report.share_token}`;

  return (
    <>
      <PageHeader
        title={report.kind === "diario" ? "Resumo do dia" : "Relatório da semana"}
        subtitle={`${company.name} · ${reportPeriodText(report.period_start, report.period_end)}`}
        actions={
          <Link href={`/${company.slug}/trafego`} className="btn">
            Voltar ao tráfego
          </Link>
        }
      />
      <div className="content grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_400px]">
        <div className="panel">
          <TrafficReportView kind={report.kind} data={report.data} notesDone={report.notes_done} notesNext={report.notes_next} hiddenAlerts={report.hidden_alerts} />
        </div>
        <ReportEditor
          slug={company.slug}
          report={{
            id: report.id,
            kind: report.kind,
            status: report.status,
            notesDone: report.notes_done ?? "",
            notesNext: report.notes_next ?? "",
            hiddenAlerts: report.hidden_alerts,
            alerts: report.data.alerts,
          }}
          url={url}
          text={whatsappText(report, url)}
        />
      </div>
    </>
  );
}
