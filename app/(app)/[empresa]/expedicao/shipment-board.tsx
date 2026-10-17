"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Pill } from "@/components/ui/pill";
import { useToast } from "@/components/ui/toast";
import { KIND_LABEL, LOGISTICS_LABEL, LOGISTICS_STEPS, NEXT_ACTION, nextStatus, scheduleDay } from "@/lib/crm/logistics";
import type { LogisticsStatus, StageLogistics } from "@/lib/crm/types";
import { formatInTimeZone } from "date-fns-tz";
import { formatDate, TIMEZONE } from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import { setLogisticsStatus } from "./actions";

export type Shipment = {
  id: string;
  kind: StageLogistics;
  pipelineName: string;
  stageName: string;
  contactName: string;
  phone: string | null;
  address: string | null;
  scheduledAt: string;
  status: LogisticsStatus;
  notes: string | null;
  deliveredAt: string | null;
  ownerName: string | null;
  products: { name: string; code: string | null; quantity: number; mode: "venda" | "locacao"; photo: string | null }[];
};

type KindFilter = "todos" | StageLogistics;

/** Atualiza a lista sozinha: o vendedor pode agendar um pedido a qualquer momento. */
const REFRESH_MS = 60_000;

export function ShipmentBoard({ slug, shipments }: { slug: string; shipments: Shipment[] }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [kind, setKind] = useState<KindFilter>("todos");
  const [confirming, setConfirming] = useState<Shipment | null>(null);

  useEffect(() => {
    const id = setInterval(() => router.refresh(), REFRESH_MS);
    return () => clearInterval(id);
  }, [router]);

  const today = formatInTimeZone(new Date(), TIMEZONE, "yyyy-MM-dd");
  const tomorrow = formatInTimeZone(new Date(Date.now() + 86_400_000), TIMEZONE, "yyyy-MM-dd");

  const groups = useMemo(() => {
    const list = shipments.filter((s) => kind === "todos" || s.kind === kind);
    const open = list.filter((s) => s.status !== "entregue");
    const byDay = (fn: (day: string) => boolean) => open.filter((s) => fn(scheduleDay(s.scheduledAt)));
    return [
      { id: "atrasados", title: "Atrasados", items: byDay((d) => d < today), late: true },
      { id: "hoje", title: "Hoje", items: byDay((d) => d === today) },
      { id: "amanha", title: "Amanhã", items: byDay((d) => d === tomorrow) },
      { id: "proximos", title: "Próximos dias", items: byDay((d) => d > tomorrow) },
      { id: "entregues", title: "Entregues nos últimos 7 dias", items: list.filter((s) => s.status === "entregue").reverse() },
    ];
  }, [shipments, kind, today, tomorrow]);

  function advance(s: Shipment, status: LogisticsStatus) {
    start(async () => {
      const r = await setLogisticsStatus(slug, { leadId: s.id, status });
      toast(r.ok ? r.message : r.error, r.ok ? "ok" : "bad");
      setConfirming(null);
      router.refresh();
    });
  }

  const openCount = shipments.filter((s) => s.status !== "entregue").length;

  return (
    <>
      <div className="toolbar">
        <div className="tabs" role="group" aria-label="Tipo de pedido">
          {(["todos", "entrega", "adaptacao"] as const).map((k) => (
            <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>
              {k === "todos" ? "Todos" : k === "entrega" ? "Entregas" : "Adaptações in loco"}
            </button>
          ))}
        </div>
        <span className="text-[13px] text-muted">{openCount} pedido(s) em aberto</span>
      </div>

      {shipments.length === 0 && (
        <div className="panel">
          <div className="empty">
            Nenhum pedido agendado. Quando um vendedor mover um lead para &quot;Entrega agendada&quot; ou &quot;Adaptação programada&quot;, ele
            aparece aqui com data, endereço e produtos.
          </div>
        </div>
      )}

      {groups.map(
        (g) =>
          g.items.length > 0 && (
            <section key={g.id} className="grid gap-2.5" aria-label={g.title}>
              <h2 className="m-0 text-[15px] font-[650]">
                {g.title} <span className="font-normal text-muted">{g.items.length}</span>
              </h2>
              <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
                {g.items.map((s) => (
                  <ShipmentCard key={s.id} s={s} late={!!g.late} pending={pending} onAdvance={(st) => (st === "entregue" ? setConfirming(s) : advance(s, st))} />
                ))}
              </div>
            </section>
          ),
      )}

      <Modal
        open={!!confirming}
        onClose={() => setConfirming(null)}
        title={confirming?.kind === "adaptacao" ? "Confirmar entrega do equipamento para adaptação?" : "Confirmar entrega?"}
        actions={
          <>
            <Button onClick={() => setConfirming(null)}>Cancelar</Button>
            <Button variant="primary" loading={pending} onClick={() => confirming && advance(confirming, "entregue")}>
              Confirmar
            </Button>
          </>
        }
      >
        <p className="m-0 text-[13.5px]">
          {confirming?.kind === "adaptacao"
            ? `O equipamento ficou com ${confirming?.contactName} para o teste. O vendedor acompanha a adaptação.`
            : `Pedido de ${confirming?.contactName} entregue. O negócio é concluído no funil e os acompanhamentos programados são criados para o vendedor.`}
        </p>
      </Modal>
    </>
  );
}

function ShipmentCard({ s, late, pending, onAdvance }: { s: Shipment; late: boolean; pending: boolean; onAdvance: (status: LogisticsStatus) => void }) {
  const next = nextStatus(s.status);
  const digits = s.phone?.replace(/\D/g, "") ?? "";
  const when = formatInTimeZone(s.scheduledAt, TIMEZONE, "dd/MM 'às' HH:mm");

  return (
    <article className="ship" data-late={late ? "" : undefined}>
      <div className="ship-head">
        <b className="min-w-0 flex-1">{s.contactName}</b>
        <Pill tone={s.kind === "adaptacao" ? "warn" : "ind"}>{KIND_LABEL[s.kind]}</Pill>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <span className="when" suppressHydrationWarning>
          {when}
        </span>
        {late && <Pill tone="bad">Atrasado</Pill>}
        <span className="text-muted">
          {s.pipelineName}
          {s.ownerName && ` · vendedor: ${s.ownerName}`}
        </span>
      </div>

      {s.address && <p className="m-0 text-[13px]">{s.address}</p>}
      {s.notes && <p className="m-0 text-[13px] text-muted">Obs.: {s.notes}</p>}

      {s.products.length > 0 ? (
        <ul className="items">
          {s.products.map((p, i) => (
            <li key={`${p.name}-${p.mode}-${i}`}>
              {p.photo ? (
                // Foto pública do catálogo; next/image exigiria configurar o domínio do Supabase.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.photo} alt="" className="thumb" loading="lazy" />
              ) : (
                <span className="thumb" aria-hidden />
              )}
              <span className="min-w-0 flex-1">
                <b className="font-semibold">{p.quantity}x</b> {p.name}
                <small className="block text-xs text-muted">
                  {p.code && `Código ${p.code} · `}
                  {p.mode === "locacao" ? "Locação" : "Venda"}
                </small>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="m-0 text-[13px] text-muted">Produtos não informados pelo vendedor.</p>
      )}

      <ol className="steps" aria-label="Andamento">
        {LOGISTICS_STEPS.map((st, i) => (
          <li key={st} data-done={i <= LOGISTICS_STEPS.indexOf(s.status) ? "" : undefined}>
            {LOGISTICS_LABEL[st]}
          </li>
        ))}
      </ol>

      <div className="links">
        {next && s.status !== "entregue" && (
          <Button size="sm" variant={next === "entregue" ? "primary" : "soft"} disabled={pending} onClick={() => onAdvance(next)}>
            {NEXT_ACTION[s.status as Exclude<LogisticsStatus, "entregue">]}
          </Button>
        )}
        {s.status === "entregue" && s.deliveredAt && <Pill tone="ok">Entregue em {formatDate(s.deliveredAt)}</Pill>}
        {digits && (
          <a className="btn sm" href={`tel:+${digits}`}>
            Ligar {formatPhone(s.phone)}
          </a>
        )}
        {s.address && (
          <a className="btn sm" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(s.address)}`} target="_blank" rel="noreferrer">
            Abrir no mapa
          </a>
        )}
      </div>
    </article>
  );
}
