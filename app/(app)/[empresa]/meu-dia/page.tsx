import type { Metadata } from "next";
import Link from "next/link";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { ptBR } from "date-fns/locale";
import { ComingSoon } from "@/components/app-shell/coming-soon";
import { PageHeader } from "@/components/app-shell/page-header";
import { Notice } from "@/components/ui/notice";
import { Panel } from "@/components/ui/panel";
import { Pill } from "@/components/ui/pill";
import { requireRole } from "@/lib/auth/viewer";
import { resolvePeriod } from "@/lib/crm/period";
import { TASK_SELECT, toTask, type TaskRow } from "@/lib/crm/tasks";
import type { StageKind } from "@/lib/crm/types";
import { formatBRL, formatBRLShort, TIMEZONE, timeAgo } from "@/lib/format";
import { firstName, initials } from "@/lib/names";
import { createClient } from "@/lib/supabase/server";
import { MyTasks } from "./my-tasks";
import { TakeButton } from "./take-button";

export const metadata: Metadata = { title: "Meu dia" };

const STALE_DAYS = 7;

type LeadRow = {
  id: string;
  owner_id: string | null;
  value: number | string;
  closed_at: string | null;
  last_contact_at: string | null;
  created_at: string;
  contacts: { name: string; org_name: string | null } | null;
  stages: { kind: StageKind; name: string } | null;
  pipelines: { key: string; name: string } | null;
  lead_sources: { name: string } | null;
};

function greeting(now: Date): string {
  const hour = Number(formatInTimeZone(now, TIMEZONE, "H"));
  return hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";
}

export default async function MeuDiaPage({ params }: { params: Promise<{ empresa: string }> }) {
  const { viewer, company } = await requireRole((await params).empresa, ["vendedor"]);
  const supabase = await createClient();
  const now = new Date();
  const endOfToday = fromZonedTime(`${formatInTimeZone(now, TIMEZONE, "yyyy-MM-dd")}T23:59:59`, TIMEZONE);
  const month = resolvePeriod("mes", now);
  const staleBefore = now.getTime() - STALE_DAYS * 86_400_000;

  const [queueRes, tasksRes, mineRes] = await Promise.all([
    // Fila: sem responsável e em aberto (o RLS mostra a fila para todo vendedor da empresa)
    supabase
      .from("leads")
      .select("id, owner_id, value, closed_at, last_contact_at, created_at, contacts(name, org_name), stages(kind, name), pipelines(key, name), lead_sources(name)")
      .eq("company_id", company.id)
      .is("owner_id", null)
      .is("closed_at", null)
      .order("created_at", { ascending: true })
      .limit(30)
      .returns<LeadRow[]>(),
    supabase
      .from("tasks")
      .select(TASK_SELECT)
      .eq("company_id", company.id)
      .eq("owner_id", viewer.id)
      .is("done_at", null)
      .lte("due_at", endOfToday.toISOString())
      .order("due_at")
      .returns<TaskRow[]>(),
    // Meus leads: em aberto + fechados neste mês
    supabase
      .from("leads")
      .select("id, owner_id, value, closed_at, last_contact_at, created_at, contacts(name, org_name), stages(kind, name), pipelines(key, name), lead_sources(name)")
      .eq("company_id", company.id)
      .eq("owner_id", viewer.id)
      .or(`closed_at.is.null,closed_at.gte."${month.start.toISOString()}"`)
      .returns<LeadRow[]>(),
  ]);

  const mine = mineRes.data ?? [];
  const open = mine.filter((l) => !l.closed_at);
  const won = mine.filter((l) => l.closed_at && l.stages?.kind === "won");
  const lost = mine.filter((l) => l.closed_at && l.stages?.kind === "lost");
  const wonValue = won.reduce((a, l) => a + (Number(l.value) || 0), 0);
  const conversion = won.length + lost.length ? Math.round((won.length / (won.length + lost.length)) * 100) : 0;
  const lastTouch = (l: LeadRow) => new Date(l.last_contact_at ?? l.created_at).getTime();
  const stale = open.filter((l) => lastTouch(l) < staleBefore).sort((a, b) => lastTouch(a) - lastTouch(b));
  const queue = queueRes.data ?? [];
  const tasks = (tasksRes.data ?? []).map(toTask);
  const date = formatInTimeZone(now, TIMEZONE, "EEEE, d 'de' MMMM", { locale: ptBR });
  const leadHref = (l: LeadRow) => `/${company.slug}/funil?funil=${l.pipelines?.key ?? ""}&lead=${l.id}`;
  const monthName = formatInTimeZone(now, TIMEZONE, "MMMM", { locale: ptBR });

  return (
    <>
      <PageHeader title={`${greeting(now)}, ${firstName(viewer.fullName)}`} subtitle={`${company.name}: ${date}`} />
      <div className="content grid gap-4">
        {(queueRes.error || tasksRes.error || mineRes.error) && <Notice tone="bad">Parte das informações não carregou. Recarregue a página.</Notice>}

        <div className="kpis kpis-3">
          <div className="kpi hl">
            <span>Fechado em {monthName}</span>
            <strong>{formatBRLShort(wonValue)}</strong>
            <em>
              {won.length} {won.length === 1 ? "negócio ganho" : "negócios ganhos"}
            </em>
          </div>
          <div className="kpi">
            <span>Conversão no mês</span>
            <strong>{conversion}%</strong>
            <em>
              {won.length} {won.length === 1 ? "ganho" : "ganhos"} e {lost.length} {lost.length === 1 ? "perdido" : "perdidos"}
            </em>
          </div>
          <div className="kpi">
            <span>Meus leads em aberto</span>
            <strong>{open.length}</strong>
            <em>{stale.length} parados há 7 dias ou mais</em>
          </div>
        </div>

        <div className="grid items-start gap-4 xl:grid-cols-2">
          <Panel title="Fila sem responsável" subtitle="Contatos novos que ninguém pegou. Quem pega vira o responsável.">
            {queue.length === 0 ? (
              <div className="empty">A fila está vazia.</div>
            ) : (
              <div className="row-list">
                {queue.map((l) => (
                  <div key={l.id} className="att">
                    <span className="av" aria-hidden>
                      {initials(l.contacts?.name ?? "?")}
                    </span>
                    <div className="grow">
                      <b>{l.contacts?.name ?? "Sem nome"}</b>
                      <small>
                        {[l.pipelines?.name, l.lead_sources?.name, `chegou ${timeAgo(l.created_at)}`].filter(Boolean).join(" · ")}
                      </small>
                    </div>
                    {Number(l.value) > 0 && <span className="text-[13px] font-semibold tabular-nums">{formatBRL(Number(l.value))}</span>}
                    <TakeButton slug={company.slug} leadId={l.id} href={leadHref(l)} />
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel title="Tarefas de hoje e atrasadas" subtitle="Marque como concluída quando terminar.">
            <MyTasks tasks={tasks} slug={company.slug} viewerId={viewer.id} />
          </Panel>

          <Panel title="Conversas esperando resposta" subtitle="As suas, ordenadas por tempo de espera.">
            <ComingSoon phase="Fase 3">As conversas do WhatsApp aparecem aqui quando o número for conectado.</ComingSoon>
          </Panel>

          <Panel title="Leads parados" subtitle={`Seus leads sem contato há ${STALE_DAYS} dias ou mais.`}>
            {stale.length === 0 ? (
              <div className="empty">Nenhum lead parado.</div>
            ) : (
              <div className="row-list">
                {stale.slice(0, 10).map((l) => (
                  <div key={l.id} className="att">
                    <span className="av" aria-hidden>
                      {initials(l.contacts?.name ?? "?")}
                    </span>
                    <div className="grow">
                      <b>{l.contacts?.name ?? "Sem nome"}</b>
                      <small>
                        {l.stages?.name} · último contato {timeAgo(l.last_contact_at ?? l.created_at)}
                      </small>
                    </div>
                    <Pill tone="warn">Parado</Pill>
                    <Link className="btn sm" href={leadHref(l)}>
                      Abrir
                    </Link>
                  </div>
                ))}
                {stale.length > 10 && <p className="m-0 pt-2 text-xs text-muted">e mais {stale.length - 10}.</p>}
              </div>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}
