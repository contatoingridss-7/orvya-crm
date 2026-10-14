"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { Notice } from "@/components/ui/notice";
import { Panel } from "@/components/ui/panel";
import { Pill } from "@/components/ui/pill";
import { useToast } from "@/components/ui/toast";
import { formatBRL, formatDateTime } from "@/lib/format";
import { COST_NOTE, templateCost, type TemplateCategory } from "@/lib/whatsapp/pricing";
import {
  CATEGORY_LABEL,
  detectVariables,
  fillTemplate,
  friendlyToMeta,
  metaToFriendly,
  normalizeTemplateName,
  rejectedReasonLabel,
  STATUS_LABEL,
  variableLabel,
  variableNames,
  type TemplateStatus,
} from "@/lib/whatsapp/templates";
import type { ActionResult } from "./actions";
import { createTemplate, deleteTemplate, syncTemplates } from "./template-actions";

export type TemplateItem = {
  id: string;
  name: string;
  category: TemplateCategory;
  status: TemplateStatus;
  body: string;
  variables: string[];
  rejectedReason: string | null;
  updatedAt: string;
};

type Props = {
  slug: string;
  templates: TemplateItem[];
  canEdit: boolean;
  hasConnectedNumber: boolean;
  loadError: boolean;
};

type Draft = { name: string; category: "MARKETING" | "UTILITY"; bodyFriendly: string };

const EXAMPLE_DEFAULT: Record<string, string> = { nome: "Maria", vendedor: "Ana", produto: "cadeira de rodas" };

export function TemplatesPanel({ slug, templates, canEdit, hasConnectedNumber, loadError }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [syncing, startSync] = useTransition();
  const [editing, setEditing] = useState<Draft | null>(null);
  const [removing, setRemoving] = useState<TemplateItem | null>(null);

  function run(fn: () => Promise<ActionResult>, after?: () => void) {
    start(async () => {
      const r = await fn();
      if (r.ok) {
        toast(r.message, "ok");
        after?.();
        router.refresh();
      } else toast(r.error, "bad");
    });
  }

  return (
    <Panel
      title="Modelos de mensagem"
      subtitle="Obrigatórios para falar com o cliente depois de 24 horas sem resposta dele. Cada modelo passa pela aprovação da Meta. Custos estimados por envio."
      actions={
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            size="sm"
            loading={syncing}
            disabled={!hasConnectedNumber}
            title={hasConnectedNumber ? undefined : "Conecte um número para consultar a Meta"}
            onClick={() =>
              startSync(async () => {
                const r = await syncTemplates(slug);
                if (r.ok) {
                  toast(r.message, "ok");
                  router.refresh();
                } else toast(r.error, "bad");
              })
            }
          >
            Atualizar status
          </Button>
          {canEdit && (
            <Button size="sm" variant="primary" onClick={() => setEditing({ name: "", category: "UTILITY", bodyFriendly: "" })}>
              Novo modelo
            </Button>
          )}
        </div>
      }
    >
      {loadError ? (
        <Notice tone="bad">Não foi possível carregar os modelos. Recarregue a página.</Notice>
      ) : templates.length === 0 ? (
        <div className="empty">
          Nenhum modelo cadastrado.{" "}
          {canEdit
            ? "Crie o primeiro em “Novo modelo”. Ex.: um aviso de retomada de orçamento para clientes que pararam de responder."
            : "Peça ao administrador para criar os modelos da empresa."}
        </div>
      ) : (
        <div className="scroll-x">
          <table>
            <thead>
              <tr>
                <th>Modelo</th>
                <th>Categoria</th>
                <th className="text-right">Custo estimado</th>
                <th>Status</th>
                {canEdit && <th aria-label="Ações" />}
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => {
                const st = STATUS_LABEL[t.status];
                const reason = t.status === "rejected" ? rejectedReasonLabel(t.rejectedReason) : null;
                const friendly = metaToFriendly(t.body, variableNames(t.body, t.variables));
                return (
                  <tr key={t.id}>
                    <td>
                      <b className="font-semibold">{t.name}</b>
                      <div className="max-w-[440px] text-xs whitespace-pre-wrap text-muted">{friendly}</div>
                    </td>
                    <td>{CATEGORY_LABEL[t.category]}</td>
                    <td className="text-right whitespace-nowrap tabular-nums">{formatBRL(templateCost(t.category))}</td>
                    <td>
                      <Pill tone={st.tone}>{st.label}</Pill>
                      {reason && <div className="mt-1 max-w-[220px] text-xs text-muted">Motivo: {reason}</div>}
                      <div className="mt-1 text-[11px] text-muted" suppressHydrationWarning>
                        {formatDateTime(t.updatedAt)}
                      </div>
                    </td>
                    {canEdit && (
                      <td>
                        <div className="flex flex-wrap justify-end gap-1.5">
                          {t.status === "draft" && (
                            <Button
                              size="sm"
                              onClick={() =>
                                setEditing({
                                  name: t.name,
                                  category: t.category === "MARKETING" ? "MARKETING" : "UTILITY",
                                  bodyFriendly: metaToFriendly(t.body, t.variables),
                                })
                              }
                            >
                              Enviar para aprovação
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" className="danger" onClick={() => setRemoving(t)}>
                            Excluir
                          </Button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="m-0 text-xs text-muted">
        Respostas em até 24 h depois da mensagem do cliente são gratuitas; só modelos enviados fora dessa janela são cobrados. Custos por envio: {COST_NOTE}.
      </p>

      {editing && (
        <TemplateModal
          initial={editing}
          pending={pending}
          hasConnectedNumber={hasConnectedNumber}
          onClose={() => setEditing(null)}
          onSubmit={(input) => run(() => createTemplate(slug, input), () => setEditing(null))}
        />
      )}

      <Modal
        open={!!removing}
        onClose={() => setRemoving(null)}
        title={`Excluir o modelo “${removing?.name ?? ""}”?`}
        actions={
          <>
            <Button onClick={() => setRemoving(null)}>Cancelar</Button>
            <Button variant="primary" loading={pending} onClick={() => removing && run(() => deleteTemplate(slug, removing.id), () => setRemoving(null))}>
              Excluir
            </Button>
          </>
        }
      >
        <p className="m-0 text-[13.5px]">
          O modelo sai do Orvya e também é excluído na Meta. As mensagens já enviadas continuam nas conversas. A Meta não deixa reaproveitar o mesmo nome por
          cerca de 30 dias.
        </p>
      </Modal>
    </Panel>
  );
}

function TemplateModal({
  initial,
  pending,
  hasConnectedNumber,
  onClose,
  onSubmit,
}: {
  initial: Draft;
  pending: boolean;
  hasConnectedNumber: boolean;
  onClose: () => void;
  onSubmit: (input: Draft & { examples: string[] }) => void;
}) {
  const [name, setName] = useState(initial.name);
  const [category, setCategory] = useState<Draft["category"]>(initial.category);
  const [body, setBody] = useState(initial.bodyFriendly);
  const [examples, setExamples] = useState<Record<string, string>>({});

  const vars = useMemo(() => detectVariables(body), [body]);
  const exampleOf = (v: string) => examples[v] ?? EXAMPLE_DEFAULT[v] ?? "";
  const preview = useMemo(() => {
    const meta = friendlyToMeta(body);
    return fillTemplate(meta.body, meta.variables, meta.variables.map((v) => examples[v] ?? EXAMPLE_DEFAULT[v] ?? ""));
  }, [body, examples]);
  const finalName = normalizeTemplateName(name);

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    onSubmit({ name, category, bodyFriendly: body, examples: vars.map(exampleOf) });
  }

  return (
    <Modal open onClose={onClose} title="Novo modelo de mensagem">
      <form onSubmit={submit} className="grid gap-3">
        <p className="m-0 text-[13px] text-muted">
          Use {"{{nome}}"}, {"{{vendedor}}"} e {"{{produto}}"} para os campos que mudam. Depois de enviado, a Meta revisa e aprova.
        </p>
        {!hasConnectedNumber && <Notice tone="warn">Nenhum número conectado: o modelo fica como rascunho até você conectar um número.</Notice>}
        <TextField
          label="Nome do modelo"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          placeholder="Ex.: lembrete_devolucao"
          hint={finalName && finalName !== name ? `Vai para a Meta como “${finalName}”.` : "Letras minúsculas, números e _ (sem acento)."}
        />
        <SelectField
          label="Categoria"
          value={category}
          onChange={(e) => setCategory(e.target.value as Draft["category"])}
          hint={`Utilidade = aviso de pedido, entrega, contrato. Marketing = oferta, convite para comprar (mais caro). Custo estimado por envio: ${formatBRL(templateCost(category))}.`}
        >
          <option value="UTILITY">Utilidade</option>
          <option value="MARKETING">Marketing</option>
        </SelectField>
        <TextAreaField
          label="Texto"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          required
          rows={4}
          maxLength={1024}
          placeholder="Olá, {{nome}}! Aqui é {{vendedor}}, da ... O orçamento de {{produto}} continua disponível. Quer que eu reserve para você?"
          hint="O texto não pode começar nem terminar com um campo entre chaves (regra da Meta)."
        />
        {vars.length > 0 && (
          <div className="grid gap-2 rounded-[12px] border border-line bg-surface-2 p-3">
            <b className="text-[13px] text-title">Exemplos para a análise da Meta</b>
            <div className="grid gap-2 sm:grid-cols-2">
              {vars.map((v) => (
                <TextField
                  key={v}
                  label={variableLabel(v)}
                  value={exampleOf(v)}
                  onChange={(e) => setExamples((x) => ({ ...x, [v]: e.target.value }))}
                  required
                  maxLength={200}
                />
              ))}
            </div>
          </div>
        )}
        {body.trim() && (
          <div className="grid gap-1">
            <span className="text-xs text-muted">Prévia</span>
            <div className="tpl-prev">{preview}</div>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancelar</Button>
          <Button type="submit" variant="primary" loading={pending}>
            {hasConnectedNumber ? "Enviar para aprovação" : "Salvar rascunho"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
