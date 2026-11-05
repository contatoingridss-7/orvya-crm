"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { Panel } from "@/components/ui/panel";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { formatBRL } from "@/lib/format";
import { TEMPLATE_COST_BRL } from "@/lib/whatsapp/pricing";
import { savePaidBudget } from "./budget-actions";

/**
 * Teto de mensagens pagas (modelos) por mês. Passou do teto, o vendedor só inicia conversa pelo
 * link grátis; gestor e administrador continuam podendo enviar modelos.
 */
export function BudgetPanel({ slug, used, limit, loadError }: { slug: string; used: number; limit: number | null; loadError: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [on, setOn] = useState(limit !== null);
  const [value, setValue] = useState(String(limit ?? 30));
  const n = Number.parseInt(value, 10);
  const valid = !on || (Number.isFinite(n) && n >= 0);

  function save() {
    start(async () => {
      const r = await savePaidBudget(slug, on ? n : null);
      if (r.ok) {
        toast(r.message, "ok");
        router.refresh();
      } else toast(r.error, "bad");
    });
  }

  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;

  return (
    <Panel
      title="Limite de mensagens pagas"
      subtitle="Modelos enviados para quem não escreveu nas últimas 24 h são cobrados pela Meta no cartão da empresa. Conversas que o cliente começa e o link grátis não têm custo."
      actions={<Switch label={on ? "Limite ligado" : "Sem limite"} checked={on} onChange={(e) => setOn(e.target.checked)} />}
    >
      {loadError && <Notice tone="bad">Não foi possível carregar o limite. Rode a migration 0026 no Supabase.</Notice>}
      <div className="grid gap-3">
        <div className="grid gap-1.5">
          <div className="flex flex-wrap items-baseline justify-between gap-2 text-[13.5px]">
            <span>
              Este mês: <b className="tabular-nums">{used}</b> {limit !== null ? <>de <b className="tabular-nums">{limit}</b></> : null} mensagens pagas
            </span>
            <small className="text-xs text-muted">até {formatBRL(used * TEMPLATE_COST_BRL.MARKETING)} (estimativa)</small>
          </div>
          {limit !== null && (
            <div className="h-2 overflow-hidden rounded-full bg-surface-2" aria-hidden>
              <div className="h-full rounded-full" style={{ width: `${pct}%`, background: pct >= 100 ? "var(--lost)" : pct >= 80 ? "var(--amber)" : "var(--accent)" }} />
            </div>
          )}
        </div>
        {on && (
          <label className="flex flex-wrap items-center gap-2 text-[13.5px]">
            <span className="text-muted">Até</span>
            <input className="inp !w-[96px]" type="number" min={0} max={100000} inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} />
            <span className="text-muted">
              mensagens pagas por mês (≈ {formatBRL((Number.isFinite(n) ? n : 0) * TEMPLATE_COST_BRL.MARKETING)} em marketing;{" "}
              {formatBRL((Number.isFinite(n) ? n : 0) * TEMPLATE_COST_BRL.UTILITY)} em utilidade)
            </span>
          </label>
        )}
        <div>
          <Button variant="primary" loading={pending} disabled={!valid} onClick={save}>
            Salvar limite
          </Button>
        </div>
      </div>
    </Panel>
  );
}
