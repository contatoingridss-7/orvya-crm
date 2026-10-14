"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { Pill, type Tone } from "@/components/ui/pill";
import { useToast } from "@/components/ui/toast";
import { formatDateTime } from "@/lib/format";
import { cancelPendingQueue } from "./actions";

export type QueueRow = {
  id: string;
  status: "pendente" | "enviando" | "enviado" | "falhou" | "cancelado";
  scheduledAt: string;
  error: string | null;
  contactName: string;
  templateName: string;
  conversationId: string;
};

const STATUS: Record<QueueRow["status"], { label: string; tone: Tone }> = {
  pendente: { label: "Pendente", tone: "ind" },
  enviando: { label: "Enviando", tone: "warn" },
  enviado: { label: "Enviado", tone: "ok" },
  falhou: { label: "Falhou", tone: "bad" },
  cancelado: { label: "Cancelado", tone: "neutral" },
};

/** Fila de envios: pendentes (com horário previsto), enviados e falhas com motivo. */
export function SendQueue({ slug, rows }: { slug: string; rows: QueueRow[] }) {
  const router = useRouter();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();

  const waiting = rows.filter((r) => r.status === "pendente" || r.status === "enviando");
  const done = rows.filter((r) => r.status !== "pendente" && r.status !== "enviando").sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt));
  const nPending = rows.filter((r) => r.status === "pendente").length;
  const count = (s: QueueRow["status"]) => rows.filter((r) => r.status === s).length;

  function cancelAll() {
    start(async () => {
      const r = await cancelPendingQueue(slug);
      setConfirming(false);
      if (r.ok) {
        toast(r.message ?? "Envios cancelados.", "ok");
        router.refresh();
      } else toast(r.error, "bad");
    });
  }

  if (!rows.length) return <div className="empty">Nenhum envio agendado nos últimos 2 dias.</div>;

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone="ind">{nPending} pendentes</Pill>
        <Pill tone="ok">{count("enviado")} enviados</Pill>
        {count("falhou") > 0 && <Pill tone="bad">{count("falhou")} com falha</Pill>}
        {count("cancelado") > 0 && <Pill>{count("cancelado")} cancelados</Pill>}
        <span className="flex-1" />
        <Button size="sm" variant="ghost" onClick={() => router.refresh()} disabled={pending}>
          Atualizar
        </Button>
        {nPending > 0 && !confirming && (
          <Button size="sm" variant="danger" onClick={() => setConfirming(true)}>
            Cancelar pendentes
          </Button>
        )}
      </div>

      {confirming && (
        <Notice tone="warn">
          <p className="m-0">
            Cancelar {nPending} {nPending === 1 ? "envio pendente" : "envios pendentes"}? O que já foi enviado não muda.
          </p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setConfirming(false)} disabled={pending}>
              Voltar
            </Button>
            <Button size="sm" variant="danger" loading={pending} onClick={cancelAll}>
              Cancelar pendentes
            </Button>
          </div>
        </Notice>
      )}

      <div className="row-list">
        {[...waiting, ...done].map((r) => (
          <div key={r.id} className="att">
            <div className="grow">
              <b>{r.contactName}</b>
              <small>
                {r.templateName} · {r.status === "pendente" ? "previsto para " : ""}
                {formatDateTime(r.scheduledAt)}
                {r.error && (
                  <>
                    {" · "}
                    <span className={r.status === "falhou" ? "text-[var(--bad-fg)]" : undefined}>{r.error}</span>
                  </>
                )}
              </small>
            </div>
            <Pill tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Pill>
            <Link className="btn sm ghost" href={`/${slug}/conversas?c=${r.conversationId}`} aria-label={`Abrir conversa com ${r.contactName}`}>
              Abrir
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}
