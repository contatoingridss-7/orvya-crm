"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { PlatformLogo } from "@/components/platform-logo";
import { TimeAgo } from "@/components/time-ago";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { Panel } from "@/components/ui/panel";
import { Pill } from "@/components/ui/pill";
import { useToast } from "@/components/ui/toast";
import type { AccountHealth } from "@/lib/ads/report";
import { formatBRL } from "@/lib/format";
import { connectAdAccount, removeAdAccount, saveAccountSettings, syncNow, type ActionResult } from "./actions";

const STATUS_PILL: Record<number, { text: string; tone: "ok" | "warn" | "bad" }> = {
  1: { text: "Ativa", tone: "ok" },
  2: { text: "Desativada", tone: "bad" },
  3: { text: "Pagamento pendente", tone: "bad" },
  7: { text: "Em análise", tone: "warn" },
  8: { text: "Liquidação pendente", tone: "warn" },
  9: { text: "Período de tolerância", tone: "warn" },
  100: { text: "Encerrando", tone: "bad" },
  101: { text: "Encerrada", tone: "bad" },
};

/** Contas de anúncio da empresa: conectar, atualizar, alerta de saldo e remover. */
export function AccountsPanel({
  slug,
  companyName,
  accounts,
  refreshing,
}: {
  slug: string;
  companyName: string;
  accounts: AccountHealth[];
  refreshing: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  // Com conta conectada, o formulário de token fica recolhido: não há o que reconectar.
  const [showConnect, setShowConnect] = useState(accounts.length === 0);

  function run(fn: () => Promise<ActionResult>) {
    start(async () => {
      const r = await fn();
      toast(r.ok ? r.message : r.error, r.ok ? "ok" : "bad");
      if (r.ok) router.refresh();
    });
  }

  function onConnect(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    setError(undefined);
    start(async () => {
      const r = await connectAdAccount(slug, { externalId: String(f.get("externalId") ?? ""), token: String(f.get("token") ?? "") });
      if (r.ok) {
        toast(r.message, "ok");
        form.reset();
        setShowConnect(false);
        router.refresh();
      } else setError(r.error);
    });
  }

  return (
    <Panel className="no-print" title={`Contas de anúncio · ${companyName}`} subtitle="Atualizam sozinhas às 6h e às 13h. Só você, como administradora, vê esta área.">
      {refreshing && (
        <Notice className="mb-3">Buscando os números mais recentes na Meta com o token guardado. Recarregue a página em alguns segundos.</Notice>
      )}
      {accounts.length > 0 && (
        <div className="row-list mb-4">
          {accounts.map((a) => (
            <div key={a.id} className="grid gap-2 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <PlatformLogo platform={a.platform} size={20} />
                <b className="font-semibold text-title">{a.name}</b>
                <span className="text-xs text-muted">act_{a.externalId}</span>
                <Pill tone="ok">Conectada</Pill>
                {a.status !== null && STATUS_PILL[a.status] && <Pill tone={STATUS_PILL[a.status]!.tone}>{STATUS_PILL[a.status]!.text}</Pill>}
                {a.isPrepay !== null && <Pill>{a.isPrepay ? "Pré-paga (boleto/PIX)" : "Pós-paga (cartão)"}</Pill>}
              </div>
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-[13px]">
                <span>
                  {a.availableBalance !== null ? "Saldo disponível" : a.capRemaining !== null ? "Restante do limite" : "Saldo"}:{" "}
                  <b>{a.availableBalance !== null ? formatBRL(a.availableBalance) : a.capRemaining !== null ? formatBRL(a.capRemaining) : "a Meta não informou"}</b>
                </span>
                <span>
                  Gasto médio por dia (7 dias): <b>{formatBRL(a.avgDailySpend)}</b>
                </span>
                {a.daysLeft !== null && (
                  <span>
                    Dura cerca de <b>{Math.floor(a.daysLeft)} dia(s)</b>
                  </span>
                )}
                <span className="text-muted">
                  {a.lastSyncedAt ? <TimeAgo date={a.lastSyncedAt} prefix="Atualizada " /> : "Ainda não atualizada"}
                </span>
              </div>
              {a.fundingDisplay && <small className="text-xs text-muted">Pagamento na Meta: {a.fundingDisplay}</small>}
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="soft" disabled={pending} onClick={() => run(() => syncNow(slug, a.id))}>
                  Atualizar agora
                </Button>
                <label className="flex items-center gap-1.5 text-xs text-muted">
                  Avisar quando o saldo durar até
                  <input
                    type="number"
                    min={1}
                    max={30}
                    defaultValue={a.lowBalanceDays}
                    className="inp !min-h-[30px] !w-16 !py-1 text-right"
                    aria-label="Dias de antecedência do alerta de saldo"
                    onBlur={(e) => {
                      const v = Number(e.target.value);
                      if (v && v !== a.lowBalanceDays) run(() => saveAccountSettings(slug, { accountId: a.id, lowBalanceDays: v }));
                    }}
                  />
                  dias
                </label>
                {confirmRemove === a.id ? (
                  <>
                    <span className="text-xs">Remover do Orvya? (nada muda na Meta)</span>
                    <Button size="sm" variant="danger" disabled={pending} onClick={() => run(() => removeAdAccount(slug, a.id))}>
                      Remover
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirmRemove(null)}>
                      Cancelar
                    </Button>
                  </>
                ) : (
                  <Button size="sm" variant="ghost" className="ml-auto" disabled={pending} onClick={() => setConfirmRemove(a.id)}>
                    Remover
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {showConnect ? (
        <>
          <h3 className="mb-2 flex items-center gap-2 text-[13px] font-[650]">
            <PlatformLogo platform="meta" /> Conectar conta da Meta
          </h3>
          <form onSubmit={onConnect} className="grid gap-2.5">
            <div className="grid gap-2.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)_auto] sm:items-end">
              <TextField label="Número da conta de anúncios" name="externalId" required inputMode="numeric" placeholder="Ex.: 1234567890 (sem act_)" />
              <TextField
                label="Token do usuário do sistema (com ads_read)"
                name="token"
                type="password"
                autoComplete="off"
                required
                placeholder="Cole o token"
              />
              <Button type="submit" variant="primary" loading={pending}>
                Conectar
              </Button>
            </div>
            <p className="m-0 text-xs text-muted">
              O número da conta aparece no Gerenciador de Anúncios (ID da conta). O token fica guardado só no servidor e nunca aparece de novo. O Orvya só lê os
              dados: não cria, pausa nem altera campanhas.
            </p>
            {error && <Notice tone="bad">{error}</Notice>}
          </form>
        </>
      ) : (
        <Button size="sm" variant="ghost" onClick={() => setShowConnect(true)}>
          Conectar outra conta
        </Button>
      )}
    </Panel>
  );
}
