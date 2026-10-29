"use client";

import { useRouter } from "next/navigation";
import { useTransition, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/field";
import { Panel } from "@/components/ui/panel";
import { useToast } from "@/components/ui/toast";
import type { Goals } from "@/lib/ads/insights";
import { saveGoals } from "./actions";

const show = (v: number | null) => (v === null ? "" : String(v).replace(".", ","));

/** Metas da gestora para este cliente: os alertas passam a comparar com elas. */
export function GoalsForm({ slug, companyName, goals, saved }: { slug: string; companyName: string; goals: Goals; saved: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const input = Object.fromEntries(new FormData(e.currentTarget));
    start(async () => {
      const r = await saveGoals(slug, input);
      toast(r.ok ? r.message : r.error, r.ok ? "ok" : "bad");
      if (r.ok) router.refresh();
    });
  }

  return (
    <Panel title="Metas do cliente" subtitle={`${companyName}: o que você considera bom. Deixe em branco o que ainda não tem referência.`}>
      <details open={!saved}>
        <summary className="cursor-pointer text-[13px] font-semibold text-muted">{saved ? "Ver e ajustar metas" : "Definir metas"}</summary>
        <form onSubmit={onSubmit} className="mt-3 grid gap-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <TextField label="Custo por conversa até (R$)" name="costPerConversationMax" inputMode="decimal" defaultValue={show(goals.costPerConversationMax)} placeholder="Ex.: 8,00" />
            <TextField label="Custo por lead real até (R$)" name="cplMax" inputMode="decimal" defaultValue={show(goals.cplMax)} placeholder="Ex.: 12,00" />
            <TextField label="Custo por venda até (R$)" name="costPerSaleMax" inputMode="decimal" defaultValue={show(goals.costPerSaleMax)} placeholder="Ex.: 80,00" />
            <TextField label="Retorno mínimo (ROAS)" name="roasMin" inputMode="decimal" defaultValue={show(goals.roasMin)} placeholder="Ex.: 4" hint="Faturamento ÷ investimento" />
            <TextField
              label="Frequência máxima (7 dias)"
              name="frequencyMax"
              inputMode="decimal"
              required
              defaultValue={show(goals.frequencyMax)}
              hint="Acima disso o criativo entra em atenção"
            />
            <TextField label="CTR mínimo (%)" name="ctrMin" inputMode="decimal" required defaultValue={show(goals.ctrMin)} hint="Cliques no link ÷ impressões" />
          </div>
          <div>
            <Button type="submit" variant="primary" loading={pending}>
              Salvar metas
            </Button>
          </div>
        </form>
      </details>
    </Panel>
  );
}
