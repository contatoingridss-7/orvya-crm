"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { Notice } from "@/components/ui/notice";
import { Pill } from "@/components/ui/pill";
import { useToast } from "@/components/ui/toast";
import type { BoardLead, LeadDetail, LeadProduct } from "@/lib/crm/types";
import { formatBRL, formatDate, formatDateTime } from "@/lib/format";
import { initials } from "@/lib/names";
import { formatPhone } from "@/lib/phone";
import { addNote, changePipeline, deleteLead, loadLeadDetail, setLeadProducts, takeLead, updateLead } from "./actions";
import type { BoardProps } from "./board";

type Props = BoardProps & { lead: BoardLead; onClose: () => void; onMove: (stageId: string) => void };

const moneyText = (v: number) => (v ? v.toFixed(2).replace(".", ",") : "");
const normalize = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export function LeadDrawer(props: Props) {
  const { lead, slug, stages, pipelines, pipeline, fields, sources, people, catalog, manager, viewerId, onClose, onMove } = props;
  const router = useRouter();
  const toast = useToast();
  const [detail, setDetail] = useState<LeadDetail | null>(null);
  const [detailError, setDetailError] = useState<string>();
  const [version, setVersion] = useState(0);
  const [saving, startSaving] = useTransition();
  const [busy, startBusy] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [formError, setFormError] = useState<string>();

  const canEdit = manager || lead.ownerId === viewerId;
  const stage = stages.find((s) => s.id === lead.stageId);
  const wonStage = stages.find((s) => s.kind === "won");
  const lostStage = stages.find((s) => s.kind === "lost");
  const ownerName = lead.ownerId ? (people.find((p) => p.id === lead.ownerId)?.name ?? "Outro responsável") : null;

  // Recarrega histórico, tarefas e produtos ao abrir, ao mudar de etapa e após cada alteração.
  useEffect(() => {
    let alive = true;
    loadLeadDetail(slug, lead.id).then((r) => {
      if (!alive) return;
      if (r.ok && r.data) setDetail(r.data);
      else if (!r.ok) setDetailError(r.error);
    });
    return () => {
      alive = false;
    };
  }, [slug, lead.id, lead.stageId, version]);

  const reload = () => setVersion((v) => v + 1);

  function onSave(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const get = (k: string) => String(f.get(k) ?? "");
    const custom = Object.fromEntries(fields.map((cf) => [cf.key, get(`cf_${cf.key}`)]));
    setFormError(undefined);
    startSaving(async () => {
      const r = await updateLead(slug, lead.id, {
        value: get("value"),
        temperature: get("temperature") as "quente" | "morno" | "frio",
        sourceId: get("sourceId"),
        ownerId: manager ? get("ownerId") : (lead.ownerId ?? ""),
        customerType: get("customerType") === "B2B" ? "B2B" : "B2C",
        custom,
        name: get("name"),
        phone: get("phone"),
        email: get("email"),
        org: get("org"),
      });
      if (r.ok) {
        toast(r.message ?? "Salvo.", "ok");
        router.refresh();
        reload();
      } else setFormError(r.error);
    });
  }

  function act(fn: () => Promise<{ ok: boolean; message?: string; error?: string }>, after?: () => void) {
    startBusy(async () => {
      const r = await fn();
      if (r.ok) {
        if (r.message) toast(r.message, "ok");
        after?.();
        router.refresh();
        reload();
      } else toast(r.error ?? "Algo deu errado.", "bad");
    });
  }

  const subtitle = [pipeline.name, stage?.name, lead.contact.phone && formatPhone(lead.contact.phone)].filter(Boolean).join(" · ");

  return (
    <>
      <Drawer
        open
        onClose={onClose}
        title={lead.contact.name}
        subtitle={subtitle}
        leading={
          <span className="av !h-11 !w-11 !text-sm text-white" style={{ background: "var(--grad)" }} aria-hidden>
            {initials(lead.contact.name)}
          </span>
        }
        footer={
          <>
            <Button variant="primary" disabled title="Disponível com o WhatsApp (Fase 3)">
              Abrir conversa
            </Button>
            {canEdit && wonStage && stage?.kind !== "won" && (
              <Button onClick={() => onMove(wonStage.id)} disabled={busy}>
                Marcar ganho
              </Button>
            )}
            {canEdit && lostStage && stage?.kind !== "lost" && (
              <Button variant="danger" onClick={() => onMove(lostStage.id)} disabled={busy}>
                Perdido
              </Button>
            )}
            {manager && (
              <Button variant="ghost" className="ml-auto" onClick={() => setConfirmDelete(true)}>
                Excluir
              </Button>
            )}
          </>
        }
      >
        {/* Etapa e responsável */}
        <section className="grid gap-2.5">
          {!lead.ownerId && !manager && (
            <Notice tone="warn">
              <div className="flex flex-wrap items-center gap-2">
                <span className="flex-1">Este lead está na fila, sem responsável.</span>
                <Button size="sm" variant="primary" loading={busy} onClick={() => act(() => takeLead(slug, lead.id))}>
                  Pegar lead
                </Button>
              </div>
            </Notice>
          )}
          {!canEdit && lead.ownerId && <Notice>Lead de {ownerName}. Você pode consultar, mas não alterar.</Notice>}
          <div className="grid gap-2.5 sm:grid-cols-2">
            <SelectField label="Funil" value={pipeline.id} disabled={!canEdit || busy} onChange={(e) => act(() => changePipeline(slug, lead.id, e.target.value), onClose)}>
              {pipelines.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </SelectField>
            <SelectField label="Etapa" value={lead.stageId} disabled={(!canEdit && lead.ownerId !== null) || busy} onChange={(e) => onMove(e.target.value)}>
              {stages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </SelectField>
          </div>
          {lead.lostReason && <Notice tone="bad">Motivo da perda: {lead.lostReason}</Notice>}
        </section>

        {/* Agente de IA */}
        <section className="dr-sec">
          <h3>Agente de IA</h3>
          {lead.aiEnabled === null ? (
            <p className="m-0 text-[13px] text-muted">Ainda não há conversa no WhatsApp com este contato. Resumo, score e estado da IA aparecem aqui a partir da Fase 3.</p>
          ) : (
            <div className="flex flex-wrap items-center gap-2 text-[13px]">
              {lead.needsHuman ? <Pill tone="bad">Precisa de você</Pill> : lead.aiEnabled ? <Pill tone="ind">IA respondendo</Pill> : <Pill>Equipe respondendo</Pill>}
              <span className="text-muted">Score {lead.score}</span>
            </div>
          )}
        </section>

        {/* Negócio e contato */}
        <form onSubmit={onSave} className="dr-sec grid gap-2.5">
          <h3>Negócio</h3>
          <fieldset disabled={!canEdit} className="m-0 grid gap-2.5 border-0 p-0 sm:grid-cols-2">
            <TextField label="Valor" name="value" inputMode="decimal" defaultValue={moneyText(lead.value)} placeholder="0,00" />
            <SelectField label="Temperatura" name="temperature" defaultValue={lead.temperature}>
              <option value="quente">Quente</option>
              <option value="morno">Morno</option>
              <option value="frio">Frio</option>
            </SelectField>
            {manager ? (
              <SelectField label="Responsável" name="ownerId" defaultValue={lead.ownerId ?? ""}>
                <option value="">Sem responsável (fila)</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </SelectField>
            ) : (
              <TextField label="Responsável" value={ownerName ?? "Sem responsável"} disabled readOnly />
            )}
            <SelectField label="Origem" name="sourceId" defaultValue={lead.sourceId ?? ""}>
              <option value="">Não informada</option>
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </SelectField>
            <TextField label="Nome" name="name" defaultValue={lead.contact.name} required />
            <TextField label="Telefone" name="phone" inputMode="tel" defaultValue={formatPhone(lead.contact.phone)} placeholder="(86) 99999-0000" />
            <TextField label="Instituição" name="org" defaultValue={lead.contact.org ?? ""} />
            <SelectField label="Tipo de cliente" name="customerType" defaultValue={lead.contact.type}>
              <option value="B2C">Paciente / família (B2C)</option>
              <option value="B2B">Instituição (B2B)</option>
            </SelectField>
            <TextField label="E-mail" name="email" type="email" defaultValue={lead.contact.email ?? ""} className="sm:col-span-2" />

            {fields.length > 0 && <h3 className="!mb-0 pt-2 text-[13px] font-[650] sm:col-span-2">Dados do funil {pipeline.name}</h3>}
            {fields.map((cf) =>
              cf.type === "select" ? (
                <SelectField key={cf.id} label={cf.label} name={`cf_${cf.key}`} defaultValue={lead.custom[cf.key] ?? ""} className={cf.fullWidth ? "sm:col-span-2" : ""}>
                  <option value="">—</option>
                  {(cf.options ?? []).map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </SelectField>
              ) : (
                <TextField
                  key={cf.id}
                  label={cf.label}
                  name={`cf_${cf.key}`}
                  type={cf.type === "number" ? "number" : cf.type === "date" ? "date" : "text"}
                  defaultValue={lead.custom[cf.key] ?? ""}
                  className={cf.fullWidth ? "sm:col-span-2" : ""}
                />
              ),
            )}
          </fieldset>
          {formError && <Notice tone="bad">{formError}</Notice>}
          {canEdit && (
            <Button type="submit" variant="soft" loading={saving} className="justify-self-start">
              Salvar alterações
            </Button>
          )}
        </form>

        {/* Produtos de interesse */}
        <ProductsSection
          products={detail?.products ?? null}
          catalog={catalog}
          canEdit={canEdit}
          busy={busy}
          onChange={(items) => act(() => setLeadProducts(slug, lead.id, items))}
        />

        {/* Tarefas */}
        <section className="dr-sec">
          <h3>Tarefas</h3>
          {!detail ? (
            <p className="m-0 text-[13px] text-muted">{detailError ?? "Carregando…"}</p>
          ) : detail.tasks.length === 0 ? (
            <p className="m-0 text-[13px] text-muted">Nenhuma tarefa. As automações criam tarefas quando o lead muda de etapa.</p>
          ) : (
            <div className="row-list">
              {detail.tasks.map((t) => {
                const late = !t.doneAt && new Date(t.dueAt) < new Date();
                return (
                  <div key={t.id} className="flex flex-wrap items-center gap-2 py-2 text-[13px]">
                    <span className={`flex-1 ${t.doneAt ? "text-muted line-through" : "font-semibold"}`}>{t.title}</span>
                    {t.origin === "automation" && <Pill tone="warn">Automação</Pill>}
                    {late ? <Pill tone="bad">Atrasada · {formatDate(t.dueAt)}</Pill> : <span className="text-xs text-muted">{t.doneAt ? "Concluída" : `Prazo ${formatDate(t.dueAt)}`}</span>}
                    {t.ownerName && <span className="text-xs text-muted">{t.ownerName}</span>}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Histórico */}
        <History detail={detail} lead={lead} canEdit={canEdit} onNote={(body, done) => act(() => addNote(slug, lead.id, body), done)} busy={busy} />
      </Drawer>

      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`Excluir ${lead.contact.name}?`}
        actions={
          <>
            <Button onClick={() => setConfirmDelete(false)}>Cancelar</Button>
            <Button
              variant="primary"
              loading={busy}
              onClick={() =>
                act(
                  () => deleteLead(slug, lead.id),
                  () => {
                    setConfirmDelete(false);
                    onClose();
                  },
                )
              }
            >
              Excluir lead
            </Button>
          </>
        }
      >
        <p className="m-0 text-[13.5px]">
          O lead, as tarefas e o histórico dele são apagados. O contato continua cadastrado. Se o negócio só não deu certo, prefira marcar como
          perdido.
        </p>
      </Modal>
    </>
  );
}

function ProductsSection({
  products,
  catalog,
  canEdit,
  busy,
  onChange,
}: {
  products: LeadProduct[] | null;
  catalog: BoardProps["catalog"];
  canEdit: boolean;
  busy: boolean;
  onChange: (items: { productId: string; mode: "venda" | "locacao"; quantity: number }[]) => void;
}) {
  const [query, setQuery] = useState("");
  const current = products ?? [];
  const items = current.map((p) => ({ productId: p.productId, mode: p.mode, quantity: p.quantity }));

  const matches = useMemo(() => {
    const q = normalize(query.trim());
    if (q.length < 2) return [];
    return catalog.filter((c) => normalize(c.name).includes(q) || (c.code ?? "") === q).slice(0, 8);
  }, [catalog, query]);

  return (
    <section className="dr-sec">
      <h3>Produtos de interesse</h3>
      {products === null ? (
        <p className="m-0 text-[13px] text-muted">Carregando…</p>
      ) : current.length === 0 ? (
        <p className="m-0 text-[13px] text-muted">Nenhum produto ligado a este lead.</p>
      ) : (
        <div className="row-list">
          {current.map((p) => (
            <div key={`${p.productId}-${p.mode}`} className="flex flex-wrap items-center gap-2 py-2 text-[13px]">
              <span className="min-w-0 flex-1">
                <b className="font-semibold">{p.name}</b>
                <small className="block text-xs text-muted">
                  {p.code && `Código ${p.code} · `}
                  {p.mode === "locacao" ? "Locação" : "Venda"}
                </small>
              </span>
              {canEdit ? (
                <input
                  type="number"
                  min={1}
                  className="inp !min-h-[32px] !w-16 !py-1 text-right"
                  defaultValue={p.quantity}
                  aria-label={`Quantidade de ${p.name}`}
                  disabled={busy}
                  onBlur={(e) => {
                    const q = Math.max(1, Math.round(Number(e.target.value) || 1));
                    if (q !== p.quantity) onChange(items.map((i) => (i.productId === p.productId && i.mode === p.mode ? { ...i, quantity: q } : i)));
                  }}
                />
              ) : (
                <span className="tabular-nums">{p.quantity}x</span>
              )}
              <span className="w-28 text-right tabular-nums">
                {p.requiresHuman ? <Pill tone="ind">Com a equipe</Pill> : p.price !== null ? formatBRL(p.price * p.quantity) : <Pill tone="warn">Sob consulta</Pill>}
              </span>
              {canEdit && (
                <button
                  type="button"
                  className="text-xs font-semibold text-[var(--bad-fg)] hover:underline"
                  disabled={busy}
                  onClick={() => onChange(items.filter((i) => !(i.productId === p.productId && i.mode === p.mode)))}
                >
                  Remover
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {canEdit && products !== null && (
        <div className="mt-2.5 grid gap-1.5">
          <input
            type="search"
            className="inp"
            placeholder="Adicionar produto do catálogo (nome ou código)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Buscar produto para adicionar"
          />
          {matches.map((c) => (
            <div key={c.id} className="flex flex-wrap items-center gap-2 rounded-[10px] border border-line bg-surface-2 px-2.5 py-1.5 text-[13px]">
              <span className="min-w-0 flex-1">
                {c.name}
                <small className="block text-xs text-muted">
                  {c.code && `Código ${c.code} · `}
                  {c.requiresHuman ? "Valor com a equipe" : c.salePrice !== null ? formatBRL(c.salePrice) : "Sob consulta"}
                </small>
              </span>
              <Button
                size="sm"
                disabled={busy}
                onClick={() => {
                  onChange([...items.filter((i) => !(i.productId === c.id && i.mode === "venda")), { productId: c.id, mode: "venda", quantity: 1 }]);
                  setQuery("");
                }}
              >
                Venda
              </Button>
              {c.isRental && (
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    onChange([...items.filter((i) => !(i.productId === c.id && i.mode === "locacao")), { productId: c.id, mode: "locacao", quantity: 1 }]);
                    setQuery("");
                  }}
                >
                  Locação
                </Button>
              )}
            </div>
          ))}
          {query.trim().length >= 2 && matches.length === 0 && <p className="m-0 text-xs text-muted">Nenhum produto ativo no catálogo com esse nome.</p>}
        </div>
      )}
    </section>
  );
}

function History({
  detail,
  lead,
  canEdit,
  busy,
  onNote,
}: {
  detail: LeadDetail | null;
  lead: BoardLead;
  canEdit: boolean;
  busy: boolean;
  onNote: (body: string, done: () => void) => void;
}) {
  const [note, setNote] = useState("");
  const kindClass = (k: string) => (k === "stage_change" ? "stage" : k === "automation" ? "auto" : "");

  return (
    <section className="dr-sec">
      <h3>Histórico</h3>
      {canEdit && (
        <div className="mb-3.5 grid gap-2">
          <TextAreaField label="Nova anotação" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="O que foi conversado, próximo passo..." />
          <Button size="sm" className="justify-self-start" disabled={!note.trim() || busy} onClick={() => onNote(note, () => setNote(""))}>
            Salvar anotação
          </Button>
        </div>
      )}
      <div className="tl">
        {(detail?.activities ?? []).map((a) => (
          <div key={a.id} className={`tl-item ${kindClass(a.kind)}`}>
            <i aria-hidden />
            <div>
              <p>{a.body}</p>
              <small>
                {formatDateTime(a.createdAt)}
                {a.userName ? ` · ${a.userName}` : a.kind === "automation" ? " · CRM" : ""}
              </small>
            </div>
          </div>
        ))}
        <div className="tl-item">
          <i aria-hidden />
          <div>
            <p>Lead criado</p>
            <small>{formatDateTime(lead.createdAt)}</small>
          </div>
        </div>
      </div>
    </section>
  );
}
