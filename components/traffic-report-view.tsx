import type { ReportData, ReportKind } from "@/lib/ads/traffic-report";
import { reportPeriodText } from "@/lib/ads/traffic-report";
import { formatBRL } from "@/lib/format";

const int = new Intl.NumberFormat("pt-BR");

/** O relatório como o cliente vê: números, leitura, melhores anúncios, funil e as observações da gestora. */
export function TrafficReportView({
  kind,
  data,
  notesDone,
  notesNext,
  hiddenAlerts,
}: {
  kind: ReportKind;
  data: ReportData;
  notesDone: string | null;
  notesNext: string | null;
  hiddenAlerts: string[];
}) {
  const daily = kind === "diario";
  const alerts = data.alerts.filter((a) => !hiddenAlerts.includes(a.id));
  const maxFunnel = Math.max(1, ...data.funnel.map((f) => f.value));

  return (
    <article className="grid gap-5">
      <header className="grid gap-1">
        <p className="m-0 text-[12px] font-semibold tracking-[0.08em] text-muted uppercase">{daily ? "Resumo do dia" : "Relatório da semana"}</p>
        <h1 className="m-0 text-[clamp(22px,4.5vw,30px)] font-bold tracking-[-0.03em] text-title">{data.companyName}</h1>
        <p className="m-0 text-muted">
          {reportPeriodText(data.since, data.until)}
          {!daily && ` · comparado com ${reportPeriodText(data.previous.since, data.previous.until)}`}
        </p>
      </header>

      <div className="kpis kpis-3">
        {data.metrics.map((x) => {
          const show = !daily && x.change !== null && Math.abs(x.change) >= 0.03;
          const good = x.change !== null && x.change > 0 === (x.better === "up");
          return (
            <div key={x.key} className={`kpi ${x.key === "conversations" ? "hl" : ""}`}>
              <span>{x.label}</span>
              <strong>{x.value}</strong>
              {show && (
                <em>
                  <b style={x.key === "conversations" ? undefined : { color: good ? "var(--ok-fg)" : "var(--bad-fg)" }}>
                    {x.change! > 0 ? "▲" : "▼"} {Math.round(Math.abs(x.change!) * 100)}%
                  </b>{" "}
                  vs semana anterior
                </em>
              )}
            </div>
          );
        })}
      </div>

      {alerts.length > 0 && (
        <section className="panel">
          <h2>O que os números mostram</h2>
          <ul className="m-0 mt-2 grid gap-2 pl-5">
            {alerts.map((a) => (
              <li key={a.id} className="text-[14px]">
                {a.text}
              </li>
            ))}
          </ul>
        </section>
      )}

      {(notesDone || notesNext) && (
        <section className="panel">
          {notesDone && (
            <>
              <h2>{daily ? "Observações" : "O que fizemos"}</h2>
              <p className="mt-2 mb-0 text-[14px] whitespace-pre-line">{notesDone}</p>
            </>
          )}
          {notesNext && (
            <>
              <h2 className={notesDone ? "mt-4" : undefined}>Próximos passos</h2>
              <p className="mt-2 mb-0 text-[14px] whitespace-pre-line">{notesNext}</p>
            </>
          )}
        </section>
      )}

      {data.creatives.length > 0 && (
        <section className="panel">
          <h2>Anúncios que mais trouxeram conversas</h2>
          <div className="mt-3 grid gap-2.5">
            {data.creatives.map((c) => (
              <div key={c.name} className="flex items-center gap-3">
                {c.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.thumbnailUrl} alt="" className="thumb" loading="lazy" referrerPolicy="no-referrer" />
                ) : (
                  <span className="thumb" aria-hidden />
                )}
                <div className="min-w-0 flex-1">
                  <b className="block truncate font-semibold text-title">{c.name}</b>
                  <small className="text-xs text-muted">
                    {int.format(c.conversations)} conversas
                    {c.costPerConversation !== null && ` · ${formatBRL(c.costPerConversation)} cada`}
                    {c.sales > 0 && ` · ${int.format(c.sales)} ${c.sales === 1 ? "venda" : "vendas"}`}
                  </small>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {!daily && (
        <section className="panel">
          <h2>Do anúncio à venda</h2>
          <div className="mt-3 grid gap-2">
            {data.funnel.map((f) => (
              <div key={f.label} className="grid grid-cols-[minmax(100px,200px)_minmax(0,1fr)_72px] items-center gap-3 text-[13px]">
                <span className="text-muted">{f.label}</span>
                <span className="relative h-5 overflow-hidden rounded-md" style={{ background: "var(--tint)" }}>
                  <span className="absolute inset-y-0 left-0 rounded-md" style={{ width: `${Math.max(1.5, Math.sqrt(f.value / maxFunnel) * 100)}%`, background: "var(--chart-navy)" }} />
                </span>
                <b className="text-right font-semibold text-title tabular-nums">{int.format(f.value)}</b>
              </div>
            ))}
          </div>
          {data.firstResponseMin !== null && (
            <p className="mt-3 mb-0 text-[13px] text-muted">
              Primeira resposta da equipe aos contatos do anúncio (mediana, em horário comercial): <b className="text-title">{Math.max(1, Math.round(data.firstResponseMin))} min</b>.
            </p>
          )}
        </section>
      )}
    </article>
  );
}
