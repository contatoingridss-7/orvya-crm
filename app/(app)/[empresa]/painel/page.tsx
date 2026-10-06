import type { Metadata } from "next";
import Link from "next/link";
import { ComingSoon } from "@/components/app-shell/coming-soon";
import { PageHeader } from "@/components/app-shell/page-header";
import { Notice } from "@/components/ui/notice";
import { Panel } from "@/components/ui/panel";
import { Pill } from "@/components/ui/pill";
import type { MemberRole } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/viewer";
import { inPeriod, resolvePeriod } from "@/lib/crm/period";
import type { Person, Pipeline, Stage, StageKind } from "@/lib/crm/types";
import { daysUntil, dueText, dueTone } from "@/lib/crm/rentals";
import { daysSince, formatBRL, formatBRLShort, timeAgo } from "@/lib/format";
import { initials } from "@/lib/names";
import { createClient } from "@/lib/supabase/server";
import { PainelFilters } from "./filters";

export const metadata: Metadata = { title: "Painel" };

const STALE_DAYS = 7;

type LeadRow = {
  id: string;
  pipeline_id: string;
  stage_id: string;
  owner_id: string | null;
  source_id: string | null;
  value: number | string;
  closed_at: string | null;
  last_contact_at: string | null;
  created_at: string;
  contacts: { name: string } | null;
  stages: { kind: StageKind } | null;
  conversations: { needs_human: boolean; needs_human_reason: string | null }[] | null;
};
type StageRow = Stage & { pipeline_id: string };
type MemberRow = { role: MemberRole; profiles: { id: string; full_name: string | null; email: string | null; active: boolean } | null };
type ContractRow = {
  id: string;
  lead_id: string;
  end_date: string;
  monthly_value: number | string;
  products: { name: string } | null;
  leads: { owner_id: string | null; contacts: { name: string } | null; pipelines: { key: string } | null } | null;
};

export default async function PainelPage({
  params,
  searchParams,
}: {
  params: Promise<{ empresa: string }>;
  searchParams: Promise<{ periodo?: string; vendedor?: string }>;
}) {
  const { viewer, company } = await requireRole((await params).empresa, ["admin", "gestor"]);
  const sp = await searchParams;
  const period = resolvePeriod(sp.periodo);
  const owner = sp.vendedor ?? "";
  const isLoc = company.slug === "locpress";
  const supabase = await createClient();

  const [pipelinesRes, stagesRes, sourcesRes, leadsRes, overdueRes, membersRes, contractsRes] = await Promise.all([
    supabase.from("pipelines").select("id, key, name, hint").eq("company_id", company.id).order("position").returns<Pipeline[]>(),
    supabase.from("stages").select("id, key, name, kind, position, pipeline_id").eq("company_id", company.id).order("position").returns<StageRow[]>(),
    supabase.from("lead_sources").select("id, name").eq("company_id", company.id).order("position").returns<{ id: string; name: string }[]>(),
    // Abertos (agora) + fechados a partir do início do período.
    supabase
      .from("leads")
      .select("id, pipeline_id, stage_id, owner_id, source_id, value, closed_at, last_contact_at, created_at, contacts(name), stages(kind), conversations(needs_human, needs_human_reason)")
      .eq("company_id", company.id)
      .or(`closed_at.is.null,closed_at.gte."${period.start.toISOString()}"`)
      .limit(5000)
      .returns<LeadRow[]>(),
    supabase
      .from("tasks")
      .select("id, owner_id")
      .eq("company_id", company.id)
      .is("done_at", null)
      .lt("due_at", new Date().toISOString())
      .returns<{ id: string; owner_id: string | null }[]>(),
    supabase.from("memberships").select("role, profiles(id, full_name, email, active)").eq("company_id", company.id).returns<MemberRow[]>(),
    isLoc
      ? supabase
          .from("rental_contracts")
          .select("id, lead_id, end_date, monthly_value, products(name), leads(owner_id, contacts(name), pipelines(key))")
          .eq("company_id", company.id)
          .eq("status", "ativo")
          .order("end_date")
          .returns<ContractRow[]>()
      : Promise.resolve({ data: [] as ContractRow[], error: null }),
  ]);

  const people: Person[] = (membersRes.data ?? [])
    .filter((m) => m.profiles?.active)
    .map((m) => ({ id: m.profiles!.id, name: m.profiles!.full_name || m.profiles!.email || "Sem nome" }));
  if (viewer.isAdmin && !people.some((p) => p.id === viewer.id)) people.push({ id: viewer.id, name: viewer.fullName });
  people.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  const byOwner = <T extends { owner_id: string | null }>(x: T) => !owner || (owner === "sem" ? x.owner_id === null : x.owner_id === owner);
  const leads = (leadsRes.data ?? []).filter(byOwner);
  const kind = (l: LeadRow): StageKind => l.stages?.kind ?? "open";
  const value = (l: LeadRow) => Number(l.value) || 0;
  const sum = (ls: LeadRow[]) => ls.reduce((a, l) => a + value(l), 0);

  const open = leads.filter((l) => !l.closed_at);
  const won = leads.filter((l) => kind(l) === "won" && inPeriod(l.closed_at, period));
  const lost = leads.filter((l) => kind(l) === "lost" && inPeriod(l.closed_at, period));
  const inBoard = [...open, ...won, ...lost];
  const needHuman = open.filter((l) => l.conversations?.some((c) => c.needs_human));
  const overdue = (overdueRes.data ?? []).filter(byOwner);
  const conversion = won.length + lost.length ? Math.round((won.length / (won.length + lost.length)) * 100) : 0;
  const periodText = period.label.toLowerCase();

  // Locação (LocPress): contratos ativos do filtro escolhido
  const contracts = (contractsRes.data ?? []).filter((c) => !owner || (owner === "sem" ? !c.leads?.owner_id : c.leads?.owner_id === owner));
  const rentalRevenue = contracts.reduce((a, c) => a + (Number(c.monthly_value) || 0), 0);
  const expiring = contracts.map((c) => ({ c, days: daysUntil(c.end_date) })).filter((x) => x.days <= 30);

  const kpis: [string, string, string][] = [
    ["Leads em aberto", String(open.length), `${needHuman.length} precisam de você agora`],
    ["Valor em negociação", formatBRLShort(sum(open)), "soma dos leads em aberto"],
    [isLoc ? "Fechado no período" : "Vendido no período", formatBRLShort(sum(won)), `${won.length} ${won.length === 1 ? "negócio ganho" : "negócios ganhos"} · ${periodText}`],
    ["Taxa de conversão", `${conversion}%`, `${won.length} ${won.length === 1 ? "ganho" : "ganhos"} e ${lost.length} ${lost.length === 1 ? "perdido" : "perdidos"}`],
    isLoc
      ? ["Receita de locação", formatBRLShort(rentalRevenue), `${contracts.length} ${contracts.length === 1 ? "contrato ativo" : "contratos ativos"} por mês`]
      : ["Tarefas atrasadas", String(overdue.length), owner ? "do filtro escolhido" : "somando toda a equipe"],
  ];

  const pipelines = pipelinesRes.data ?? [];
  const stages = stagesRes.data ?? [];

  // Origem: fechados e perdidos no período + em aberto
  const sources = (sourcesRes.data ?? [])
    .map((s) => {
      const x = inBoard.filter((l) => l.source_id === s.id);
      const w = x.filter((l) => kind(l) === "won");
      return { name: s.name, total: x.length, won: w.length, lost: x.filter((l) => kind(l) === "lost").length, revenue: sum(w) };
    })
    .concat(
      (() => {
        const x = inBoard.filter((l) => !l.source_id);
        const w = x.filter((l) => kind(l) === "won");
        return x.length ? [{ name: "Origem não informada", total: x.length, won: w.length, lost: x.filter((l) => kind(l) === "lost").length, revenue: sum(w) }] : [];
      })(),
    )
    .sort((a, b) => b.total - a.total);
  const maxSource = Math.max(1, ...sources.map((s) => s.total));

  // Precisa de atenção: pedido de humano + parados há 7 dias ou mais
  const pipelineKey = new Map(pipelines.map((p) => [p.id, p.key]));
  const attention = [
    ...needHuman.map((l) => ({ l, why: l.conversations?.find((c) => c.needs_human)?.needs_human_reason ?? "Pediu atendimento humano", tag: <Pill tone="bad">Precisa de você</Pill> })),
    ...open
      .filter((l) => !needHuman.includes(l) && daysSince(l.last_contact_at ?? l.created_at) >= STALE_DAYS)
      .sort((a, b) => value(b) - value(a))
      .map((l) => ({ l, why: `Último contato ${timeAgo(l.last_contact_at ?? l.created_at)}`, tag: <Pill tone="warn">Parado</Pill> })),
  ];

  return (
    <>
      <PageHeader title="Painel" subtitle={`${company.name}: como está a operação comercial hoje`} />
      <div className="content grid gap-4">
        <PainelFilters people={people} period={period.key} owner={owner} />
        {leadsRes.error && <Notice tone="bad">Não foi possível carregar os números. Recarregue a página.</Notice>}

        <div className="kpis">
          {kpis.map(([label, big, small], i) => (
            <div key={label} className={`kpi ${i === 2 ? "hl" : ""}`}>
              <span>{label}</span>
              <strong>{big}</strong>
              <em>{small}</em>
            </div>
          ))}
        </div>

        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <div className="grid content-start gap-4">
            <Panel title="Funil por etapa" subtitle={`Leads em aberto agora e fechados ${periodText}`}>
              {pipelines.map((p) => {
                const ps = stages.filter((s) => s.pipeline_id === p.id);
                const pl = inBoard.filter((l) => l.pipeline_id === p.id);
                const max = Math.max(1, ...ps.map((s) => pl.filter((l) => l.stage_id === s.id).length));
                return (
                  <div key={p.id} className="pipe-block">
                    <h3>
                      <Link href={`/${company.slug}/funil?funil=${p.key}`} className="hover:underline">
                        {p.name}
                      </Link>
                      <span>{pl.filter((l) => !l.closed_at).length} em aberto</span>
                    </h3>
                    <div className="bars">
                      {ps.map((s) => {
                        const items = pl.filter((l) => l.stage_id === s.id);
                        return (
                          <div key={s.id} className="bar">
                            <span className="truncate">{s.name}</span>
                            <div className="track">
                              <div className={`fill ${s.kind}`} style={{ width: `${items.length ? Math.max(4, (items.length / max) * 100) : 0}%` }} />
                            </div>
                            <span className="val">
                              {items.length} · {formatBRLShort(sum(items))}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </Panel>

            <Panel
              title="Origem dos leads"
              subtitle={
                <>
                  <span className="dot" style={{ background: "var(--won)" }} /> fechados &nbsp; <span className="dot" style={{ background: "#F87171" }} /> perdidos &nbsp;{" "}
                  <span className="dot" style={{ background: "var(--accent)" }} /> em aberto. É aqui que se mede o retorno de cada campanha.
                </>
              }
            >
              <div className="row-list">
                {sources.map((s) => (
                  <div key={s.name} className="origin">
                    <b>{s.name}</b>
                    <small>
                      {s.total} leads, {s.won} {s.won === 1 ? "fechado" : "fechados"}, {formatBRLShort(s.revenue)}
                    </small>
                    <div className="track" style={{ width: `${s.total ? Math.max(6, (s.total / maxSource) * 100) : 6}%` }}>
                      {s.total > 0 && (
                        <>
                          <i style={{ width: `${(s.won / s.total) * 100}%`, background: "var(--won)" }} />
                          <i style={{ width: `${(s.lost / s.total) * 100}%`, background: "#F87171" }} />
                          <i style={{ flex: 1, background: "var(--accent)", opacity: 0.6 }} />
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
          </div>

          <div className="grid content-start gap-4">
            <Panel title="Precisa de atenção" subtitle={`Pedidos de atendimento humano e leads parados há ${STALE_DAYS} dias ou mais`}>
              {attention.length === 0 ? (
                <div className="empty">Nada pendente agora.</div>
              ) : (
                <div className="row-list">
                  {attention.slice(0, 8).map(({ l, why, tag }) => (
                    <div key={l.id} className="att">
                      <span className="av" aria-hidden>
                        {initials(l.contacts?.name ?? "?")}
                      </span>
                      <div className="grow">
                        <b>{l.contacts?.name ?? "Sem nome"}</b>
                        <small>{why}</small>
                      </div>
                      {tag}
                      <Link className="btn sm" href={`/${company.slug}/funil?funil=${pipelineKey.get(l.pipeline_id) ?? ""}&lead=${l.id}`}>
                        Abrir
                      </Link>
                    </div>
                  ))}
                  {attention.length > 8 && <p className="m-0 pt-2 text-xs text-muted">e mais {attention.length - 8}.</p>}
                </div>
              )}
            </Panel>

            {isLoc && (
              <Panel title="Contratos de locação vencendo" subtitle="Próximos 30 dias. Ofereça a renovação antes de a família procurar outra empresa.">
                {expiring.length === 0 ? (
                  <div className="empty">Nenhum contrato vence nos próximos 30 dias.</div>
                ) : (
                  <div className="row-list">
                    {expiring.map(({ c, days }) => (
                      <div key={c.id} className="att">
                        <span className="av" aria-hidden>
                          {initials(c.leads?.contacts?.name ?? "?")}
                        </span>
                        <div className="grow">
                          <b>{c.leads?.contacts?.name ?? "Sem nome"}</b>
                          <small>
                            {c.products?.name ?? "Equipamento"}, {formatBRL(Number(c.monthly_value))} por mês
                          </small>
                        </div>
                        <Pill tone={dueTone(days)}>{dueText(days)}</Pill>
                        <Link className="btn sm" href={`/${company.slug}/funil?funil=${c.leads?.pipelines?.key ?? ""}&lead=${c.lead_id}`}>
                          Abrir
                        </Link>
                      </div>
                    ))}
                  </div>
                )}
              </Panel>
            )}

            <Panel title="WhatsApp" subtitle="Conversas iniciadas pelo cliente neste mês. As primeiras 1.000 de cada número não têm custo de mensagem.">
              <ComingSoon phase="Fase 3">Status dos números e contador de conversas aparecem quando o WhatsApp for conectado.</ComingSoon>
            </Panel>
          </div>
        </div>
      </div>
    </>
  );
}
