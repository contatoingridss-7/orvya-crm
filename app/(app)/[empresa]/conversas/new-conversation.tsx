"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { SelectField, TextField } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { Notice } from "@/components/ui/notice";
import { useToast } from "@/components/ui/toast";
import { formatBRL } from "@/lib/format";
import { templateCost, type TemplateCategory } from "@/lib/whatsapp/pricing";
import { CATEGORY_LABEL, fillTemplate, prefillValues, variableLabel, variableNames } from "@/lib/whatsapp/templates";
import { startByLink, startConversation } from "./actions";

type Template = { id: string; name: string; category: TemplateCategory; body: string; variables: string[] };
type Option = { id: string; label: string };
type Mode = "link" | "modelo";
type LinkResult = { conversationId: string; text: string };

/**
 * Nova conversa pelo Orvya, em dois caminhos:
 * - Link grátis (padrão): o vendedor manda por SMS/Instagram/ligação um link do WhatsApp da empresa;
 *   o cliente toca, a conversa começa por ele e não tem custo.
 * - Modelo aprovado (pago pela Meta), dentro do limite mensal da empresa.
 */
export function NewConversationButton({
  slug,
  numbers,
  pipelines,
  templates,
  viewerName,
  companyName,
  manager,
  budget,
}: {
  slug: string;
  numbers: Option[];
  pipelines: Option[];
  templates: Template[];
  viewerName: string;
  companyName: string;
  manager: boolean;
  /** Mensagens pagas no mês e o limite da empresa (null = sem limite). */
  budget: { used: number; limit: number | null };
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("link");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [numberId, setNumberId] = useState(numbers[0]?.id ?? "");
  const [pipelineId, setPipelineId] = useState(pipelines[0]?.id ?? "");
  // Utilidade (mais barata) primeiro.
  const sorted = useMemo(() => [...templates].sort((a, b) => templateCost(a.category) - templateCost(b.category) || a.name.localeCompare(b.name)), [templates]);
  const [templateId, setTemplateId] = useState(sorted[0]?.id ?? "");
  const [values, setValues] = useState<string[]>([]);
  const [result, setResult] = useState<LinkResult | null>(null);
  const [error, setError] = useState<string>();
  const [sending, start] = useTransition();

  const t = sorted.find((x) => x.id === templateId) ?? null;
  const names = useMemo(() => (t ? variableNames(t.body, t.variables) : []), [t]);
  const overBudget = budget.limit !== null && budget.used >= budget.limit;
  const paidBlocked = overBudget && !manager;

  function openModal() {
    setError(undefined);
    setResult(null);
    setMode("link");
    setValues(t ? prefillValues(t.body, t.variables, { contactName: name, sellerName: viewerName }) : []);
    setOpen(true);
  }

  function close() {
    setOpen(false);
    if (result) {
      setName("");
      setPhone("");
      setResult(null);
    }
  }

  function pickTemplate(id: string) {
    setTemplateId(id);
    const next = sorted.find((x) => x.id === id);
    setValues(next ? prefillValues(next.body, next.variables, { contactName: name, sellerName: viewerName }) : []);
  }

  // O primeiro nome digitado entra no campo "nome" do modelo, se ainda estiver vazio.
  function changeName(v: string) {
    setName(v);
    if (!t) return;
    const auto = prefillValues(t.body, t.variables, { contactName: v, sellerName: viewerName });
    setValues((cur) => names.map((n, i) => (n === "nome" || n === "cliente" ? (auto[i] ?? "") : (cur[i] ?? auto[i] ?? ""))));
  }

  const phoneOk = phone.replace(/\D/g, "").length >= 10;
  const completeModel = !!t && phoneOk && names.every((_, i) => values[i]?.trim()) && !paidBlocked;

  function makeLink() {
    setError(undefined);
    start(async () => {
      const r = await startByLink(slug, { name, phone, numberId, pipelineId });
      if (r.ok && r.conversationId && r.text) {
        setResult({ conversationId: r.conversationId, text: r.text });
        router.refresh();
      } else if (!r.ok) setError(r.error);
    });
  }

  function sendModel() {
    if (!t) return;
    setError(undefined);
    start(async () => {
      const r = await startConversation(slug, { name, phone, numberId, pipelineId, templateId: t.id, values });
      if (r.ok) {
        toast(r.message ?? "Conversa iniciada.", "ok");
        setOpen(false);
        setName("");
        setPhone("");
        router.push(`/${slug}/conversas${r.conversationId ? `?c=${r.conversationId}` : ""}`);
        router.refresh();
      } else setError(r.error);
    });
  }

  async function copy() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.text);
      toast("Mensagem copiada. Cole no SMS, Instagram ou onde preferir.", "ok");
    } catch {
      toast("Não foi possível copiar. Selecione o texto e copie.", "bad");
    }
  }

  async function share() {
    if (!result) return;
    try {
      await navigator.share({ text: result.text });
    } catch {
      // Cancelado pelo usuário ou sem suporte: o botão Copiar continua disponível.
    }
  }

  const clientDigits = (() => {
    const d = phone.replace(/\D/g, "");
    return d.length === 10 || d.length === 11 ? `55${d}` : d;
  })();
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  const noNumber = numbers.length === 0 ? "Nenhum número de WhatsApp conectado." : null;

  const actions = result ? (
    <>
      <Button onClick={close}>Fechar</Button>
      <Button
        variant="primary"
        onClick={() => {
          const id = result.conversationId;
          close();
          router.push(`/${slug}/conversas?c=${id}`);
        }}
      >
        Abrir conversa
      </Button>
    </>
  ) : (
    <>
      <Button onClick={close}>Cancelar</Button>
      {mode === "link" ? (
        <Button variant="primary" loading={sending} disabled={!phoneOk || !!noNumber} onClick={makeLink}>
          Gerar link grátis
        </Button>
      ) : (
        <Button variant="primary" loading={sending} disabled={!completeModel || !!noNumber} onClick={sendModel}>
          Enviar modelo ({t ? formatBRL(templateCost(t.category)) : "pago"})
        </Button>
      )}
    </>
  );

  return (
    <>
      <Button variant="primary" className="round" onClick={openModal} aria-label="Nova conversa" data-tip="Nova conversa">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
          <path d="M12 5v14M5 12h14" />
        </svg>
      </Button>
      <Modal open={open} onClose={close} title="Nova conversa no WhatsApp" actions={actions}>
        {noNumber ? (
          <Notice tone="warn">{noNumber}</Notice>
        ) : result ? (
          <div className="grid gap-3">
            <Notice tone="ok">
              Pronto! Mande a mensagem abaixo para o cliente. Quando ele tocar no link e enviar, a conversa começa por ele (sem custo) e cai direto com você.
            </Notice>
            <div className="tpl-prev select-all break-words">{result.text}</div>
            <div className="flex flex-wrap gap-2">
              <a className="btn" href={`sms:+${clientDigits}?&body=${encodeURIComponent(result.text)}`}>
                Enviar por SMS
              </a>
              {canShare && <Button onClick={share}>Compartilhar</Button>}
              <Button onClick={copy}>Copiar mensagem</Button>
            </div>
            <small className="text-xs text-muted">Dica: na ligação, diga “vou te mandar um link, é só tocar e enviar o oi”.</small>
          </div>
        ) : (
          <div className="grid gap-3">
            <div className="tabs" role="group" aria-label="Como iniciar">
              <button type="button" aria-pressed={mode === "link"} onClick={() => setMode("link")}>
                Link grátis
              </button>
              <button type="button" aria-pressed={mode === "modelo"} onClick={() => setMode("modelo")}>
                Modelo pago
              </button>
            </div>
            <p className="m-0 text-[12.5px] text-muted">
              {mode === "link"
                ? `Recomendado. O Orvya gera sua saudação com um link do WhatsApp da ${companyName}. Você manda por SMS, Instagram ou na ligação; o cliente toca, envia o “oi” e a conversa é gratuita.`
                : "Pela regra da Meta, a primeira mensagem para quem não escreveu nas últimas 24 h é um modelo aprovado, cobrado no cartão da empresa. Use quando o cliente não tiver como tocar no link."}
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField label="Nome do cliente" value={name} onChange={(e) => changeName(e.target.value)} maxLength={120} placeholder="Ex.: Maria Souza" />
              <TextField label="WhatsApp com DDD" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="(86) 99999-0000" required />
              {pipelines.length > 1 && (
                <SelectField label="Funil" value={pipelineId} onChange={(e) => setPipelineId(e.target.value)}>
                  {pipelines.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </SelectField>
              )}
              {numbers.length > 1 && (
                <SelectField label={mode === "link" ? "Número da empresa" : "Enviar pelo número"} value={numberId} onChange={(e) => setNumberId(e.target.value)}>
                  {numbers.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.label}
                    </option>
                  ))}
                </SelectField>
              )}
            </div>

            {mode === "modelo" &&
              (sorted.length === 0 ? (
                <Notice tone="warn">Nenhum modelo aprovado. Use o link grátis ou peça ao administrador para criar modelos em Canais.</Notice>
              ) : (
                <>
                  <SelectField label="Modelo" value={templateId} onChange={(e) => pickTemplate(e.target.value)}>
                    {sorted.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name} ({CATEGORY_LABEL[x.category]}, {formatBRL(templateCost(x.category))})
                      </option>
                    ))}
                  </SelectField>
                  {t && names.length > 0 && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {names.map((n, i) => (
                        <TextField
                          key={`${t.id}-${n}-${i}`}
                          label={variableLabel(n)}
                          value={values[i] ?? ""}
                          onChange={(e) => setValues((list) => names.map((_, j) => (j === i ? e.target.value : (list[j] ?? ""))))}
                          maxLength={200}
                          placeholder={n === "produto" ? "Ex.: cadeira de rodas" : undefined}
                        />
                      ))}
                    </div>
                  )}
                  {t && (
                    <div className="tpl-prev" aria-label="Prévia da mensagem">
                      {fillTemplate(t.body, names, values)}
                    </div>
                  )}
                  <small className="text-xs text-muted">
                    Mensagens pagas este mês: {budget.used}
                    {budget.limit !== null ? ` de ${budget.limit}` : ""}. Custo estimado deste envio: {t ? formatBRL(templateCost(t.category)) : "–"}{" "}
                    (valor aproximado, cobrado pela Meta).
                  </small>
                  {overBudget && (
                    <Notice tone={paidBlocked ? "bad" : "warn"}>
                      {paidBlocked
                        ? "A empresa já usou as mensagens pagas deste mês. Use o link grátis ou peça ao gestor para enviar."
                        : "O limite de mensagens pagas deste mês foi atingido. Como gestor, você ainda pode enviar."}
                    </Notice>
                  )}
                </>
              ))}
            {error && <Notice tone="bad">{error}</Notice>}
          </div>
        )}
      </Modal>
    </>
  );
}
