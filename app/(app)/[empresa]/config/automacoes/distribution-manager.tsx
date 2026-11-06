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
export type Distribution = {
  enabled: boolean;
  routes: { pipelineId: string; keywords: string[] }[];
  workDays: Record<string, number[]>;
  /** Intervalo de almoço por vendedor: [início, fim] "HH:mm". */
  breaks: Record<string, [string, string][]>;
  /** Funis em que o vendedor recebe leads pelo rodízio (ausente = os que ele enxerga). */
  rotationPipelines: Record<string, string[]>;
  /** Minutos sem resposta antes de repassar o lead ao próximo do rodízio (ausente = nunca). */
  reassignMinutes: Record<string, number>;
  /** Ordem de prioridade por funil (no lugar do rodízio): {"<pipeline_id>": ["<user_id>", ...]}. */
  priority: Record<string, string[]>;
};

const REASSIGN_OPTIONS = [3, 5, 10, 15, 30];

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
  // Almoço sempre visível: os dois horários vazios = sem almoço.
  const [breaks, setBreaks] = useState<Record<string, [string, string]>>(() =>
    Object.fromEntries(sellers.map((s) => [s.id, settings?.breaks?.[s.id]?.[0] ?? ["", ""]])),
  );
  const [rotation, setRotation] = useState<Record<string, string[] | null>>(() =>
    Object.fromEntries(sellers.map((s) => [s.id, settings?.rotationPipelines?.[s.id] ?? null])),
  );
  const [reassign, setReassign] = useState<Record<string, number | null>>(() =>
    Object.fromEntries(sellers.map((s) => [s.id, settings?.reassignMinutes?.[s.id] ?? null])),
  );
  const [priority, setPriority] = useState<Record<string, string[]>>(() => ({ ...(settings?.priority ?? {}) }));
  const [error, setError] = useState<string>();

  /** Vendedores que enxergam o funil (podem entrar na ordem). */
  const canWork = (pipelineId: string) => sellers.filter((s) => !s.pipelineIds?.length || s.pipelineIds.includes(pipelineId));
  const nameOf = (id: string) => sellers.find((s) => s.id === id)?.name ?? "Vendedor removido";
  function setOrder(pipelineId: string, list: string[] | null) {
    setPriority((p) => {
      const next = { ...p };
      if (list === null) delete next[pipelineId];
      else next[pipelineId] = list;
      return next;
    });
  }
  function move(pipelineId: string, i: number, delta: number) {
    const list = [...(priority[pipelineId] ?? [])];
    const j = i + delta;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j]!, list[i]!];
    setOrder(pipelineId, list);
  }

  /** Funis que o vendedor enxerga (restrição de Equipe). */
  const visible = (s: DistSeller) => pipelines.filter((p) => !s.pipelineIds?.length || s.pipelineIds.includes(p.id));
  /** Quem recebe leads do funil pelo rodízio. */
  const inPipeline = (pipelineId: string) =>
    sellers.filter((s) => (!s.pipelineIds?.length || s.pipelineIds.includes(pipelineId)) && (!rotation[s.id] || rotation[s.id]!.includes(pipelineId)));

  function toggleRotation(seller: DistSeller, pipelineId: string) {
    setRotation((r) => {
      const cur = r[seller.id] ?? visible(seller).map((p) => p.id);
      const next = cur.includes(pipelineId) ? cur.filter((x) => x !== pipelineId) : [...cur, pipelineId];
      // Todos os que enxerga = sem restrição (null).
      return { ...r, [seller.id]: next.length === visible(seller).length ? null : next };
    });
  }

  function toggleDay(sellerId: string, n: number) {
    setWorkDays((w) => {
      const cur = w[sellerId] ?? [];
      return { ...w, [sellerId]: cur.includes(n) ? cur.filter((d) => d !== n) : [...cur, n].sort() };
    });
  }

  function save() {
    setError(undefined);
    const half = sellers.find((s) => !breaks[s.id]?.[0] !== !breaks[s.id]?.[1]);
    if (half) return setError(`Preencha o início e o fim do almoço de ${half.name} (ou deixe os dois vazios).`);
    start(async () => {
      const r = await saveDistribution(slug, {
        enabled,
        routes: pipelines.map((p) => ({ pipelineId: p.id, keywords: keywords[p.id] ?? "" })),
        workDays,
        breaks: Object.fromEntries(Object.entries(breaks).map(([id, b]) => [id, b[0] && b[1] ? [b] : []])),
        rotationPipelines: rotation,
        reassignMinutes: reassign,
        priority: Object.fromEntries(Object.entries(priority).filter(([, l]) => l.length > 0)),
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
            const order = priority[p.id];
            return (
              <div key={p.id} className="grid gap-2 rounded-xl border border-line p-3">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <b className="font-semibold text-title">{p.name}</b>
                  <small className="text-xs text-muted">
                    {order
                      ? `Prioridade: ${order.map(nameOf).join(" → ")} (sempre o primeiro disponível; o repasse segue a ordem)`
                      : list.length === 0
                        ? "Nenhum vendedor neste funil: os leads ficam para o gestor distribuir."
                        : `Rodízio: ${list.map((s) => s.name).join(" → ")}${list.length > 1 ? " → (volta ao início)" : ""}`}
                  </small>
                </div>
                <div className="grid gap-1.5 text-[13px]">
                  <label className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={!!order}
                      onChange={(e) => setOrder(p.id, e.target.checked ? canWork(p.id).map((s) => s.id) : null)}
                    />
                    Usar ordem de prioridade neste funil (em vez do rodízio)
                  </label>
                  {order && (
                    <ol className="m-0 grid list-none gap-1 p-0">
                      {order.map((id, i) => (
                        <li key={id} className="flex flex-wrap items-center gap-2">
                          <span className="w-5 text-right tabular-nums text-muted">{i + 1}º</span>
                          <b className="min-w-[140px] font-semibold">{nameOf(id)}</b>
                          <Button size="sm" variant="ghost" disabled={i === 0} aria-label={`Subir ${nameOf(id)}`} onClick={() => move(p.id, i, -1)}>
                            Subir
                          </Button>
                          <Button size="sm" variant="ghost" disabled={i === order.length - 1} aria-label={`Descer ${nameOf(id)}`} onClick={() => move(p.id, i, 1)}>
                            Descer
                          </Button>
                          <Button size="sm" variant="ghost" aria-label={`Tirar ${nameOf(id)} da ordem`} onClick={() => setOrder(p.id, order.filter((x) => x !== id))}>
                            Tirar
                          </Button>
                        </li>
                      ))}
                      {canWork(p.id)
                        .filter((s) => !order.includes(s.id))
                        .map((s) => (
                          <li key={s.id}>
                            <Button size="sm" variant="ghost" onClick={() => setOrder(p.id, [...order, s.id])}>
                              + Incluir {s.name}
                            </Button>
                          </li>
                        ))}
                    </ol>
                  )}
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
          <div className="grid gap-2.5">
            <h3 className="m-0 text-[14px] font-[650]">Vendedores no rodízio</h3>
            <p className="m-0 text-[12.5px] text-muted">
              Fora dos dias marcados e no horário de almoço, o vendedor sai do rodízio e o lead vai para quem está disponível. Se ninguém do funil estiver
              disponível, o lead é distribuído assim que alguém voltar (a rotina confere a cada 15 minutos).
            </p>
            {sellers.map((s) => {
              const b = breaks[s.id] ?? ["", ""];
              const rot = rotation[s.id] ?? null;
              return (
                <div key={s.id} className="grid gap-2.5 rounded-xl border border-line p-3 text-[13.5px]">
                  <b className="font-semibold text-title">{s.name}</b>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    <span className="w-[86px] text-xs font-semibold text-muted">Dias</span>
                    {DAYS.map((d) => (
                      <label key={d.n} className="flex items-center gap-1">
                        <input type="checkbox" checked={(workDays[s.id] ?? []).includes(d.n)} onChange={() => toggleDay(s.id, d.n)} />
                        {d.label}
                      </label>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="w-[86px] text-xs font-semibold text-muted">Almoço</span>
                    <span className="text-muted">das</span>
                    <input type="time" className="inp !w-[110px]" value={b[0]} aria-label={`Início do almoço de ${s.name}`} onChange={(e) => setBreaks((x) => ({ ...x, [s.id]: [e.target.value, b[1]] }))} />
                    <span className="text-muted">às</span>
                    <input type="time" className="inp !w-[110px]" value={b[1]} aria-label={`Fim do almoço de ${s.name}`} onChange={(e) => setBreaks((x) => ({ ...x, [s.id]: [b[0], e.target.value] }))} />
                    {b[0] || b[1] ? (
                      <Button size="sm" variant="ghost" onClick={() => setBreaks((x) => ({ ...x, [s.id]: ["", ""] }))}>
                        Sem almoço
                      </Button>
                    ) : (
                      <small className="text-xs text-muted">vazio = sem almoço</small>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    <span className="w-[86px] text-xs font-semibold text-muted">Recebe leads</span>
                    {visible(s).map((p) => (
                      <label key={p.id} className="flex items-center gap-1">
                        <input type="checkbox" checked={rot === null || rot.includes(p.id)} onChange={() => toggleRotation(s, p.id)} />
                        {p.name}
                      </label>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="w-[86px] text-xs font-semibold text-muted">Repasse</span>
                    <select
                      className="inp !w-auto"
                      aria-label={`Repasse automático de ${s.name}`}
                      value={reassign[s.id] ?? ""}
                      onChange={(e) => setReassign((x) => ({ ...x, [s.id]: e.target.value ? Number(e.target.value) : null }))}
                    >
                      <option value="">Nunca repassar</option>
                      {REASSIGN_OPTIONS.map((m) => (
                        <option key={m} value={m}>
                          Sem resposta em {m} min → próximo do rodízio
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              );
            })}
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
