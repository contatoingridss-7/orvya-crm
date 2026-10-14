"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { TimeAgo } from "@/components/time-ago";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { Pill } from "@/components/ui/pill";
import { useToast } from "@/components/ui/toast";
import { formatBRL } from "@/lib/format";
import { firstName, initials } from "@/lib/names";
import { COST_NOTE, templateCost, type TemplateCategory } from "@/lib/whatsapp/pricing";
import { CATEGORY_LABEL, fillTemplate, prefillValues, variableLabel, variableNames } from "@/lib/whatsapp/templates";
import { reactivateLeads } from "./actions";

export type StaleLead = {
  leadId: string;
  conversationId: string;
  name: string;
  stage: string;
  pipeline: string;
  ownerName: string | null;
  /** Primeiro nome que vai no campo {{vendedor}}: responsável do lead ou quem está enviando. */
  sellerName: string;
  productName: string | null;
  days: number;
  lastContact: string;
  temperature: "quente" | "morno" | "frio";
  queued: boolean;
};

export type ReactivateTemplate = { id: string; name: string; category: TemplateCategory; body: string; variables: string[] };

const DAY_CHIPS = [2, 5, 7, 14] as const;
const MAX_BATCH = 100;

export function ReactivatePanel({ slug, leads, templates }: { slug: string; leads: StaleLead[]; templates: ReactivateTemplate[] }) {
  const router = useRouter();
  const toast = useToast();
  const [idle, setIdle] = useState<number>(7);
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const [step, setStep] = useState<"select" | "review">("select");
  const [tplId, setTplId] = useState(templates[0]?.id ?? "");
  const [values, setValues] = useState<Record<string, string[]>>({});
  const [excluded, setExcluded] = useState<Record<string, boolean>>({});
  const [bulk, setBulk] = useState<Record<number, string>>({});
  const [confirming, setConfirming] = useState(false);
  const [sending, start] = useTransition();

  const eligible = leads.filter((l) => l.days >= idle);
  const selectable = eligible.filter((l) => !l.queued);
  const selected = selectable.filter((l) => sel[l.leadId]);
  const allChecked = selectable.length > 0 && selected.length === selectable.length;

  const tpl = templates.find((t) => t.id === tplId) ?? null;
  const names = tpl ? variableNames(tpl.body, tpl.variables) : [];

  const prefillOne = (t: ReactivateTemplate, l: StaleLead) =>
    prefillValues(t.body, t.variables, { contactName: l.name, sellerName: l.sellerName, productName: l.productName });

  function prefillFor(t: ReactivateTemplate, list: StaleLead[]): Record<string, string[]> {
    return Object.fromEntries(list.map((l) => [l.leadId, prefillOne(t, l)]));
  }

  function startReview() {
    if (!selected.length) return;
    if (selected.length > MAX_BATCH) {
      toast(`Selecione no máximo ${MAX_BATCH} leads por vez.`, "bad");
      return;
    }
    setValues(tpl ? prefillFor(tpl, selected) : {});
    setExcluded({});
    setBulk({});
    setConfirming(false);
    setStep("review");
  }

  function pickTemplate(id: string) {
    setTplId(id);
    const next = templates.find((t) => t.id === id);
    setValues(next ? prefillFor(next, selected) : {});
    setBulk({});
    setConfirming(false);
  }

  function setValue(leadId: string, i: number, v: string) {
    setValues((all) => ({ ...all, [leadId]: (all[leadId] ?? names.map(() => "")).map((x, j) => (j === i ? v : x)) }));
    setConfirming(false);
  }

  function applyBulk(i: number) {
    const v = (bulk[i] ?? "").trim();
    if (!v) return;
    setValues((all) => {
      const next = { ...all };
      for (const l of selected) {
        const row = next[l.leadId] ?? names.map(() => "");
        if (!row[i]?.trim()) next[l.leadId] = row.map((x, j) => (j === i ? v : x));
      }
      return next;
    });
    setConfirming(false);
  }

  const isComplete = (leadId: string) => {
    const row = values[leadId];
    return !!row && row.length === names.length && row.every((v) => v.trim());
  };
  const included = selected.filter((l) => !excluded[l.leadId] && isComplete(l.leadId));
  const incompleteCount = selected.filter((l) => !isComplete(l.leadId)).length;
  const unitCost = tpl ? templateCost(tpl.category) : 0;
  // Campos que algum lead ainda não tem (para o "preencher os em branco").
  const blankFields = names.map((n, i) => ({ n, i })).filter(({ i }) => selected.some((l) => !values[l.leadId]?.[i]?.trim()));

  function send() {
    if (!tpl || !included.length) return;
    start(async () => {
      const r = await reactivateLeads(slug, {
        templateId: tpl.id,
        items: included.map((l) => ({ leadId: l.leadId, conversationId: l.conversationId, values: values[l.leadId] ?? [] })),
      });
      if (r.ok) {
        toast(r.message ?? "Envios agendados.", "ok");
        setSel({});
        setStep("select");
        setConfirming(false);
        router.refresh();
      } else {
        toast(r.error, "bad");
        setConfirming(false);
      }
    });
  }

  if (step === "review") {
    if (!tpl) {
      return (
        <div className="grid gap-3">
          <Notice tone="warn">
            Nenhum modelo aprovado pela Meta.{" "}
            <Link className="underline" href={`/${slug}/config/canais`}>
              Crie e envie um modelo para aprovação em Canais e integrações.
            </Link>
          </Notice>
          <div>
            <Button onClick={() => setStep("select")}>Voltar</Button>
          </div>
        </div>
      );
    }
    return (
      <div className="grid gap-3">
        <p className="sub !mb-0">
          Leads parados estão fora da janela de 24 horas, então a reativação usa um modelo aprovado pela Meta. O texto é fixo; só os campos entre
          chaves mudam.
        </p>
        <label className="field">
          <span>Modelo</span>
          <select value={tplId} onChange={(e) => pickTemplate(e.target.value)} disabled={sending}>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({CATEGORY_LABEL[t.category]})
              </option>
            ))}
          </select>
        </label>

        {blankFields.length > 0 && (
          <div className="grid gap-2 rounded-xl border border-line bg-surface-2 p-3">
            <p className="m-0 text-[12.5px] text-muted">Alguns leads estão sem valor para estes campos. Preencha aqui para aplicar a todos que estiverem em branco:</p>
            {blankFields.map(({ n, i }) => (
              <div key={`${tpl.id}-${n}-${i}`} className="flex flex-wrap items-end gap-2">
                <TextField
                  className="min-w-0 flex-1"
                  label={variableLabel(n)}
                  value={bulk[i] ?? ""}
                  onChange={(e) => setBulk((b) => ({ ...b, [i]: e.target.value }))}
                  maxLength={200}
                  placeholder={n === "produto" ? "Ex.: cadeira de rodas" : undefined}
                  disabled={sending}
                />
                <Button onClick={() => applyBulk(i)} disabled={sending || !(bulk[i] ?? "").trim()}>
                  Aplicar aos em branco
                </Button>
              </div>
            ))}
          </div>
        )}

        <div className="grid gap-2.5">
          {selected.map((l) => {
            const row = values[l.leadId] ?? names.map(() => "");
            const complete = isComplete(l.leadId);
            const missing = names.filter((_, i) => !row[i]?.trim());
            // Campos que não vieram preenchidos do cadastro ficam editáveis (mesmo depois de digitar).
            const auto = prefillOne(tpl, l);
            const editable = names.map((_, i) => !auto[i]?.trim());
            return (
              <div key={l.leadId} className="draft" data-off={!complete || excluded[l.leadId] ? "true" : undefined}>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={complete && !excluded[l.leadId]}
                    disabled={!complete || sending}
                    onChange={(e) => setExcluded((x) => ({ ...x, [l.leadId]: !e.target.checked }))}
                    aria-label={`Incluir ${l.name} no envio`}
                  />
                  <span className="av" aria-hidden>
                    {initials(l.name)}
                  </span>
                  <span className="min-w-0">
                    <b className="block truncate">{l.name}</b>
                    <span className="text-xs text-muted">
                      {l.stage}, último contato <TimeAgo date={l.lastContact} />
                    </span>
                  </span>
                </label>
                {missing.length > 0 && (
                  <Notice tone="warn">Falta preencher: {missing.map(variableLabel).join(", ")}. Este lead fica de fora até completar.</Notice>
                )}
                {editable.some(Boolean) && (
                  <>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {names.map((n, i) =>
                        !editable[i] ? null : (
                          <TextField
                            key={`${n}-${i}`}
                            label={variableLabel(n)}
                            value={row[i] ?? ""}
                            onChange={(e) => setValue(l.leadId, i, e.target.value)}
                            maxLength={200}
                            disabled={sending}
                          />
                        ),
                      )}
                    </div>
                  </>
                )}
                <p className="whitespace-pre-wrap">{fillTemplate(tpl.body, names, row)}</p>
              </div>
            );
          })}
        </div>

        <div className="cost">
          <span>
            {included.length} × {formatBRL(unitCost)} ({CATEGORY_LABEL[tpl.category]})
          </span>
          <b>Custo estimado: {formatBRL(included.length * unitCost)}</b>
        </div>
        <p className="m-0 text-[11.5px] text-muted">
          {COST_NOTE.charAt(0).toUpperCase() + COST_NOTE.slice(1)}.
          {incompleteCount > 0 && ` ${incompleteCount} ${incompleteCount === 1 ? "lead está" : "leads estão"} sem os campos obrigatórios e não ${incompleteCount === 1 ? "será enviado" : "serão enviados"}.`}
        </p>

        {confirming ? (
          <Notice tone="warn">
            <p className="m-0">
              Confirmar o envio do modelo <b>{tpl.name}</b> para {included.length} {included.length === 1 ? "lead" : "leads"}? Custo estimado de{" "}
              {formatBRL(included.length * unitCost)}. As mensagens saem uma a uma, com 2 a 6 minutos entre elas
              {included.length > 1 && ` (cerca de ${Math.round((included.length - 1) * 4 + 1)} minutos no total)`}. Dá para cancelar as pendentes na fila de envios.
            </p>
            <div className="mt-2.5 flex flex-wrap gap-2">
              <Button onClick={() => setConfirming(false)} disabled={sending}>
                Voltar
              </Button>
              <Button variant="primary" loading={sending} onClick={send}>
                Confirmar envio
              </Button>
            </div>
          </Notice>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setStep("select")} disabled={sending}>
              Cancelar
            </Button>
            <Button variant="primary" disabled={!included.length} onClick={() => setConfirming(true)}>
              {included.length ? `Reativar ${included.length} ${included.length === 1 ? "lead" : "leads"}` : "Nenhum lead pronto para enviar"}
            </Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      <div className="toolbar">
        <span className="text-[13px] text-muted">Sem contato há pelo menos</span>
        <div className="chips">
          {DAY_CHIPS.map((d) => (
            <button key={d} type="button" className="chip" aria-pressed={idle === d} onClick={() => setIdle(d)}>
              {d} dias
            </button>
          ))}
        </div>
      </div>
      <p className="sub !mb-0">Leads em aberto, com conversa de WhatsApp em número conectado e sem pedido de atendimento pendente.</p>

      {eligible.length === 0 ? (
        <div className="empty">Nenhum lead parado nesse período.</div>
      ) : (
        <>
          {selectable.length > 0 && (
            <label className="check text-[13px] font-semibold">
              <input
                type="checkbox"
                checked={allChecked}
                onChange={(e) => setSel(e.target.checked ? Object.fromEntries(selectable.map((l) => [l.leadId, true])) : {})}
              />
              Selecionar todos ({selectable.length})
            </label>
          )}
          <div className="row-list">
            {eligible.map((l) => (
              <label key={l.leadId} className="q-item check" style={{ cursor: l.queued ? "default" : "pointer" }}>
                <input
                  type="checkbox"
                  checked={!l.queued && !!sel[l.leadId]}
                  disabled={l.queued}
                  onChange={(e) => setSel((s) => ({ ...s, [l.leadId]: e.target.checked }))}
                  aria-label={`Selecionar ${l.name}`}
                />
                <div className="grow">
                  <b>{l.name}</b>
                  <p>
                    {[l.pipeline, l.stage].filter(Boolean).join(", ")}. {l.ownerName ? firstName(l.ownerName) : "Sem responsável"}, parado há {l.days}{" "}
                    {l.days === 1 ? "dia" : "dias"}
                  </p>
                </div>
                {l.queued ? <Pill tone="ind">Na fila</Pill> : <span className={`dot t-${l.temperature}`} title={l.temperature} />}
              </label>
            ))}
          </div>
          <div>
            <Button variant="primary" disabled={!selected.length} onClick={startReview}>
              {selected.length ? `Escolher modelo para ${selected.length} ${selected.length === 1 ? "lead" : "leads"}` : "Selecione leads para reativar"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
