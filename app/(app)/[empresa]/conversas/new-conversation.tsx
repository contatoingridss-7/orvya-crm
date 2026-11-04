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
import { startConversation } from "./actions";

type Template = { id: string; name: string; category: TemplateCategory; body: string; variables: string[] };
type Option = { id: string; label: string };

/**
 * Nova conversa pelo Orvya: a primeira mensagem para quem ainda não escreveu é um modelo aprovado
 * (regra da Meta). Quando o cliente responder, a conversa abre para texto livre.
 */
export function NewConversationButton({
  slug,
  numbers,
  pipelines,
  templates,
  viewerName,
}: {
  slug: string;
  numbers: Option[];
  pipelines: Option[];
  templates: Template[];
  viewerName: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [numberId, setNumberId] = useState(numbers[0]?.id ?? "");
  const [pipelineId, setPipelineId] = useState(pipelines[0]?.id ?? "");
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [values, setValues] = useState<string[]>([]);
  const [error, setError] = useState<string>();
  const [sending, start] = useTransition();

  const t = templates.find((x) => x.id === templateId) ?? null;
  const names = useMemo(() => (t ? variableNames(t.body, t.variables) : []), [t]);

  function openModal() {
    setError(undefined);
    setValues(t ? prefillValues(t.body, t.variables, { contactName: name, sellerName: viewerName }) : []);
    setOpen(true);
  }

  function pickTemplate(id: string) {
    setTemplateId(id);
    const next = templates.find((x) => x.id === id);
    setValues(next ? prefillValues(next.body, next.variables, { contactName: name, sellerName: viewerName }) : []);
  }

  // O primeiro nome digitado entra no campo "nome" do modelo, se ainda estiver vazio.
  function changeName(v: string) {
    setName(v);
    if (!t) return;
    const auto = prefillValues(t.body, t.variables, { contactName: v, sellerName: viewerName });
    setValues((cur) => names.map((n, i) => (n === "nome" || n === "cliente" ? (auto[i] ?? "") : (cur[i] ?? auto[i] ?? ""))));
  }

  const complete = !!t && phone.replace(/\D/g, "").length >= 10 && names.every((_, i) => values[i]?.trim());

  function send() {
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

  const blocked = numbers.length === 0 ? "Nenhum número de WhatsApp conectado." : templates.length === 0 ? "Nenhum modelo aprovado. Atualize os modelos em Canais." : null;

  return (
    <>
      <Button variant="primary" onClick={openModal}>
        Nova conversa
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Nova conversa no WhatsApp"
        actions={
          <>
            <Button onClick={() => setOpen(false)}>Cancelar</Button>
            <Button variant="primary" loading={sending} disabled={!complete || !!blocked} onClick={send}>
              Enviar e abrir conversa
            </Button>
          </>
        }
      >
        {blocked ? (
          <Notice tone="warn">{blocked}</Notice>
        ) : (
          <div className="grid gap-3">
            <p className="m-0 text-[12.5px] text-muted">
              Pela regra da Meta, a primeira mensagem para quem ainda não escreveu é um modelo aprovado. Quando o cliente responder, você conversa
              normalmente.
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
                <SelectField label="Enviar pelo número" value={numberId} onChange={(e) => setNumberId(e.target.value)}>
                  {numbers.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.label}
                    </option>
                  ))}
                </SelectField>
              )}
            </div>
            <SelectField label="Modelo" value={templateId} onChange={(e) => pickTemplate(e.target.value)}>
              {templates.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name} ({CATEGORY_LABEL[x.category]})
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
            {t && <small className="text-xs text-muted">Custo estimado: {formatBRL(templateCost(t.category))} (valor aproximado, cobrado pela Meta).</small>}
            {error && <Notice tone="bad">{error}</Notice>}
          </div>
        )}
      </Modal>
    </>
  );
}
