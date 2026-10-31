"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { Panel } from "@/components/ui/panel";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { saveDistribution } from "./distribution-actions";

export type DistPipeline = { id: string; name: string };
export type DistSeller = { id: string; name: string; pipelineIds: string[] | null };
export type Distribution = { enabled: boolean; routes: { pipelineId: string; keywords: string[] }[]; workDays: Record<string, number[]> };

const DAYS = [
  { n: 1, label: "Seg" },
  { n: 2, label: "Ter" },
  { n: 3, label: "Qua" },
  { n: 4, label: "Qui" },
  { n: 5, label: "Sex" },
  { n: 6, label: "Sáb" },
  { n: 7, label: "Dom" },
];

/**
 * Rodízio justo por funil (um lead para cada vendedor, em ordem), só no horário de atendimento,
 * respeitando os dias de cada vendedor; e palavras-chave que levam o lead direto a um funil.
 */
export function DistributionManager({
  slug,
  pipelines,
  sellers,
  settings,
  loadError,
}: {
  slug: string;
  pipelines: DistPipeline[];
  sellers: DistSeller[];
  settings: Distribution | null;
  loadError: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [enabled, setEnabled] = useState(settings?.enabled ?? false);
  const [keywords, setKeywords] = useState<Record<string, string>>(() =>
    Object.fromEntries(pipelines.map((p) => [p.id, settings?.routes.find((r) => r.pipelineId === p.id)?.keywords.join(", ") ?? ""])),
  );
  const [workDays, setWorkDays] = useState<Record<string, number[]>>(() =>
    Object.fromEntries(sellers.map((s) => [s.id, settings?.workDays[s.id] ?? [1, 2, 3, 4, 5, 6]])),
  );
  const [error, setError] = useState<string>();

  const inPipeline = (pipelineId: string) => sellers.filter((s) => !s.pipelineIds?.length || s.pipelineIds.includes(pipelineId));

  function toggleDay(sellerId: string, n: number) {
    setWorkDays((w) => {
      const cur = w[sellerId] ?? [];
      return { ...w, [sellerId]: cur.includes(n) ? cur.filter((d) => d !== n) : [...cur, n].sort() };
    });
  }

  function save() {
    setError(undefined);
    start(async () => {
      const r = await saveDistribution(slug, {
        enabled,
        routes: pipelines.map((p) => ({ pipelineId: p.id, keywords: keywords[p.id] ?? "" })),
        workDays,
      });
      if (r.ok) {
        toast(r.message, "ok");
        router.refresh();
      } else setError(r.error);
    });
  }

  return (
    <Panel
      title="Distribuição de leads"
      subtitle="Rodízio justo: cada lead novo vai para o próximo vendedor do funil, um de cada vez. Só distribui no horário de atendimento; o que chega fora dele é distribuído na abertura, às 8h."
      actions={<Switch label={enabled ? "Desligar rodízio" : "Ligar rodízio"} checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />}
    >
      {loadError && <Notice tone="bad">Não foi possível carregar. Rode a migration 0020 no Supabase.</Notice>}
      {sellers.length === 0 && <Notice tone="warn">Nenhum vendedor cadastrado nesta empresa. Cadastre a equipe em Configurações → Equipe; enquanto isso, os leads ficam sem dono.</Notice>}

      <div className="grid gap-5">
        <div className="grid gap-3">
          <h3 className="m-0 text-[14px] font-[650]">Funis</h3>
          {pipelines.map((p) => {
            const list = inPipeline(p.id);
            return (
              <div key={p.id} className="grid gap-2 rounded-xl border border-line p-3">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <b className="font-semibold text-title">{p.name}</b>
                  <small className="text-xs text-muted">
                    {list.length === 0
                      ? "Nenhum vendedor neste funil: os leads ficam para o gestor distribuir."
                      : `Rodízio: ${list.map((s) => s.name).join(" → ")}${list.length > 1 ? " → (volta ao início)" : ""}`}
                  </small>
                </div>
                <label className="grid gap-1 text-[13px]">
                  <span className="text-muted">Palavras que abrem o lead direto neste funil (separadas por vírgula)</span>
                  <input
                    className="inp"
                    value={keywords[p.id] ?? ""}
                    placeholder="Ex.: cpap, bipap, máscara nasal"
                    onChange={(e) => setKeywords((k) => ({ ...k, [p.id]: e.target.value }))}
                  />
                </label>
              </div>
            );
          })}
        </div>

        {sellers.length > 0 && (
          <div className="grid gap-2">
            <h3 className="m-0 text-[14px] font-[650]">Dias de cada vendedor</h3>
            <p className="m-0 text-[12.5px] text-muted">Quem não trabalha no dia fica fora do rodízio. Se ninguém do funil trabalha, o lead espera o próximo dia útil.</p>
            {sellers.map((s) => (
              <div key={s.id} className="flex flex-wrap items-center gap-2 text-[13.5px]">
                <span className="w-[140px] truncate font-semibold">{s.name}</span>
                {DAYS.map((d) => (
                  <label key={d.n} className="flex items-center gap-1">
                    <input type="checkbox" checked={(workDays[s.id] ?? []).includes(d.n)} onChange={() => toggleDay(s.id, d.n)} />
                    {d.label}
                  </label>
                ))}
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" loading={pending} onClick={save}>
            Salvar distribuição
          </Button>
          {error && <Notice tone="bad">{error}</Notice>}
        </div>
      </div>
    </Panel>
  );
}
