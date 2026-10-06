"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { useToast } from "@/components/ui/toast";
import type { BoardLead, CatalogOption, CustomField, Option, Person, Pipeline, Stage } from "@/lib/crm/types";
import { TEMPERATURE_LABEL } from "@/lib/crm/types";
import { TimeAgo } from "@/components/time-ago";
import { formatBRL, formatBRLShort } from "@/lib/format";
import { firstName, initials } from "@/lib/names";
import { dueText, dueTone } from "@/lib/crm/rentals";
import { moveLead } from "./actions";
import { ContractModal } from "./contract-modal";
import { LeadDrawer } from "./lead-drawer";
import { LostModal } from "./lost-modal";
import { NewLeadModal } from "./new-lead-modal";

export type BoardProps = {
  slug: string;
  companyName: string;
  pipelines: Pipeline[];
  pipeline: Pipeline;
  stages: Stage[];
  leads: BoardLead[];
  fields: CustomField[];
  sources: Option[];
  lostReasons: Option[];
  people: Person[];
  catalog: CatalogOption[];
  viewerId: string;
  manager: boolean;
  /** LocPress: contratos de locação. */
  hasRentals: boolean;
  initialLeadId: string | null;
  closedWindowDays: number;
};

type OwnerFilter = "todos" | "meus" | "sem" | string;
const normalize = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export function Board(props: BoardProps) {
  const { slug, pipelines, pipeline, stages, people, sources, viewerId, manager } = props;
  const router = useRouter();
  const toast = useToast();
  const [, startTransition] = useTransition();

  // Movimentos otimistas: o card muda de coluna na hora; some quando o servidor devolve os dados novos.
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [baseLeads, setBaseLeads] = useState(props.leads);
  if (baseLeads !== props.leads) {
    setBaseLeads(props.leads);
    setOverrides({});
  }
  const leads = useMemo(() => props.leads.map((l) => (overrides[l.id] ? { ...l, stageId: overrides[l.id]! } : l)), [props.leads, overrides]);

  const [owner, setOwner] = useState<OwnerFilter>("todos");
  const [temperature, setTemperature] = useState("");
  const [source, setSource] = useState("");
  const [query, setQuery] = useState("");
  const [openLeadId, setOpenLeadId] = useState<string | null>(props.initialLeadId);
  const [lostTarget, setLostTarget] = useState<{ leadId: string; stageId: string } | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [dragging, setDragging] = useState<BoardLead | null>(null);
  const [contractLead, setContractLead] = useState<BoardLead | null>(null);

  const peopleById = useMemo(() => new Map(people.map((p) => [p.id, p.name])), [people]);
  const stageById = useMemo(() => new Map(stages.map((s) => [s.id, s])), [stages]);

  const visible = useMemo(() => {
    const q = normalize(query.trim());
    const digits = query.replace(/\D/g, "");
    return leads.filter((l) => {
      if (owner === "meus" && l.ownerId !== viewerId) return false;
      if (owner === "sem" && l.ownerId !== null) return false;
      if (owner !== "todos" && owner !== "meus" && owner !== "sem" && l.ownerId !== owner) return false;
      if (temperature && l.temperature !== temperature) return false;
      if (source && l.sourceId !== source) return false;
      if (!q) return true;
      return (
        normalize(l.contact.name).includes(q) ||
        normalize(l.contact.org ?? "").includes(q) ||
        (digits.length >= 3 && (l.contact.phone ?? "").includes(digits))
      );
    });
  }, [leads, owner, temperature, source, query, viewerId]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    // No celular, segurar o card um instante para arrastar; o toque rápido abre o lead.
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );

  function move(leadId: string, stageId: string, lostReason?: string) {
    const lead = leads.find((l) => l.id === leadId);
    if (!lead || lead.stageId === stageId) return;
    setOverrides((o) => ({ ...o, [leadId]: stageId }));
    startTransition(async () => {
      const result = await moveLead(slug, leadId, stageId, lostReason);
      if (!result.ok) {
        setOverrides((o) => {
          const next = { ...o };
          delete next[leadId];
          return next;
        });
        toast(result.error, "bad");
        return;
      }
      toast(`${firstName(lead.contact.name)} foi para ${stageById.get(stageId)?.name ?? "outra etapa"}.`);
      if (result.data?.tookLead) toast("Você virou o responsável por este lead.", "ok");
      for (const t of result.data?.tasks ?? []) toast(`Automação criou a tarefa “${t}”.`, "auto");
      // LocPress: ao entrar em "Em locação" sem contrato ativo, pede os dados do contrato (SPEC 4.4).
      const target = stageById.get(stageId);
      if (props.hasRentals && pipeline.key === "locacao" && target?.key === "ativo" && lead.rentalDaysLeft === null) {
        setContractLead(lead);
      }
      router.refresh();
    });
  }

  /** Mudança de etapa vinda do arraste, do seletor do detalhe ou dos botões ganho/perdido. */
  function requestMove(leadId: string, stageId: string) {
    if (stageById.get(stageId)?.kind === "lost") setLostTarget({ leadId, stageId });
    else move(leadId, stageId);
  }

  function onDragStart(e: DragStartEvent) {
    setDragging(leads.find((l) => l.id === e.active.id) ?? null);
  }
  function onDragEnd(e: DragEndEvent) {
    setDragging(null);
    if (e.over) requestMove(String(e.active.id), String(e.over.id));
  }

  const openLead = leads.find((l) => l.id === openLeadId) ?? null;
  const lostLead = lostTarget ? leads.find((l) => l.id === lostTarget.leadId) : null;
  const filtersOn = owner !== "todos" || temperature || source || query;

  return (
    <>
      <div className="toolbar">
        {pipelines.length > 1 && (
          <nav className="tabs" aria-label="Funis">
            {pipelines.map((p) => (
              <Link
                key={p.id}
                href={`/${slug}/funil?funil=${p.key}`}
                className={`rounded-[9px] px-3.5 py-1.5 text-[13px] font-semibold ${p.id === pipeline.id ? "text-white" : "text-muted hover:text-ink"}`}
                style={p.id === pipeline.id ? { background: "var(--grad)" } : undefined}
                aria-current={p.id === pipeline.id ? "page" : undefined}
                title={p.hint ?? undefined}
              >
                {p.name}
              </Link>
            ))}
          </nav>
        )}
        <label className="search flex-1">
          <svg viewBox="0 0 24 24" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-4-4" />
          </svg>
          <input type="search" placeholder="Buscar nome, instituição ou telefone" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Buscar leads" />
        </label>
        <select className="inp !w-auto" value={owner} onChange={(e) => setOwner(e.target.value)} aria-label="Responsável">
          <option value="todos">{manager ? "Todos os responsáveis" : "Meus e da fila"}</option>
          <option value="meus">Meus leads</option>
          <option value="sem">Sem responsável</option>
          {manager &&
            people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
        </select>
        <select className="inp !w-auto" value={temperature} onChange={(e) => setTemperature(e.target.value)} aria-label="Temperatura">
          <option value="">Todas as temperaturas</option>
          <option value="quente">Quente</option>
          <option value="morno">Morno</option>
          <option value="frio">Frio</option>
        </select>
        <select className="inp !w-auto" value={source} onChange={(e) => setSource(e.target.value)} aria-label="Origem">
          <option value="">Todas as origens</option>
          {sources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <Button variant="primary" onClick={() => setNewOpen(true)}>
          Novo lead
        </Button>
      </div>

      {filtersOn && (
        <p className="m-0 text-[12.5px] text-muted">
          Mostrando {visible.length} de {leads.length} leads.{" "}
          <button
            type="button"
            className="font-semibold text-tint-ink hover:underline"
            onClick={() => {
              setOwner("todos");
              setTemperature("");
              setSource("");
              setQuery("");
            }}
          >
            Limpar filtros
          </button>
        </p>
      )}

      {/* id fixo: sem ele a biblioteca gera ids de acessibilidade diferentes no servidor e no navegador */}
      <DndContext id={`funil-${pipeline.id}`} sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
        <div className="board" aria-label={`Funil ${pipeline.name}`}>
          {stages.map((stage) => {
            const items = visible.filter((l) => l.stageId === stage.id);
            return (
              <Column key={stage.id} stage={stage} count={items.length} total={items.reduce((s, l) => s + l.value, 0)} closedWindowDays={props.closedWindowDays}>
                {items.length === 0 ? (
                  <p className="m-0 py-6 text-center text-xs text-muted">Arraste um card para cá</p>
                ) : (
                  items.map((l) => (
                    <DraggableCard key={l.id} lead={l} ownerName={l.ownerId ? (peopleById.get(l.ownerId) ?? "Responsável") : null} onOpen={() => setOpenLeadId(l.id)} />
                  ))
                )}
              </Column>
            );
          })}
        </div>
        <DragOverlay dropAnimation={null}>
          {dragging && <LeadCard lead={dragging} ownerName={dragging.ownerId ? (peopleById.get(dragging.ownerId) ?? null) : null} overlay />}
        </DragOverlay>
      </DndContext>

      {openLead && (
        <LeadDrawer
          key={openLead.id}
          {...props}
          lead={openLead}
          onClose={() => setOpenLeadId(null)}
          onMove={(stageId) => requestMove(openLead.id, stageId)}
        />
      )}

      <LostModal
        open={!!lostTarget && !!lostLead}
        leadName={lostLead ? firstName(lostLead.contact.name) : ""}
        reasons={props.lostReasons}
        onClose={() => setLostTarget(null)}
        onConfirm={(reason) => {
          if (lostTarget) move(lostTarget.leadId, lostTarget.stageId, reason);
          setLostTarget(null);
        }}
      />

      <ContractModal
        open={!!contractLead}
        slug={slug}
        leadId={contractLead?.id ?? ""}
        leadName={contractLead ? firstName(contractLead.contact.name) : ""}
        catalog={props.catalog}
        defaultAddress={contractLead?.custom.endereco}
        onClose={() => setContractLead(null)}
        onSaved={() => {
          setContractLead(null);
          router.refresh();
        }}
      />

      <NewLeadModal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        slug={slug}
        companyName={props.companyName}
        pipelines={pipelines}
        pipeline={pipeline}
        stages={stages}
        sources={sources}
        people={people}
        manager={manager}
        onCreated={(id) => {
          setNewOpen(false);
          setOpenLeadId(id);
          router.refresh();
        }}
      />
    </>
  );
}

function Column({ stage, count, total, closedWindowDays, children }: { stage: Stage; count: number; total: number; closedWindowDays: number; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  return (
    <section ref={setNodeRef} className={`col ${isOver ? "over" : ""}`} data-kind={stage.kind} aria-label={stage.name}>
      <header className="col-head">
        <div className="t">
          {stage.name}
          <span className="n">{count}</span>
        </div>
        <small>
          {formatBRLShort(total)}
          {stage.kind !== "open" && ` · últimos ${closedWindowDays} dias`}
        </small>
        <div className="stripe" />
      </header>
      <div className="col-body">{children}</div>
    </section>
  );
}

function DraggableCard({ lead, ownerName, onOpen }: { lead: BoardLead; ownerName: string | null; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: lead.id });
  return <LeadCard lead={lead} ownerName={ownerName} onOpen={onOpen} nodeRef={setNodeRef} dragProps={{ ...attributes, ...listeners }} dragging={isDragging} />;
}

type LeadCardProps = {
  lead: BoardLead;
  ownerName: string | null;
  onOpen?: () => void;
  overlay?: boolean;
  dragging?: boolean;
  nodeRef?: (el: HTMLElement | null) => void;
  dragProps?: React.HTMLAttributes<HTMLElement>;
};

function LeadCard({ lead: l, ownerName, onOpen, overlay, dragging, nodeRef, dragProps }: LeadCardProps) {
  return (
    <button
      type="button"
      ref={nodeRef}
      {...dragProps}
      className={`kcard ${l.needsHuman ? "need" : ""} ${overlay ? "overlay" : ""} ${dragging ? "dragging" : ""}`}
      onClick={onOpen}
      aria-label={`Abrir ${l.contact.name}`}
    >
      <span className="l1">
        <span className={`dot t-${l.temperature}`} title={TEMPERATURE_LABEL[l.temperature]} aria-label={`Temperatura ${TEMPERATURE_LABEL[l.temperature]}`} />
        <b>{l.contact.name}</b>
        {l.contact.type === "B2B" && <Pill>B2B</Pill>}
      </span>
      {l.contact.org && <span className="org">{l.contact.org}</span>}
      <span className="l3">
        <span className="val">{formatBRL(l.value)}</span>
        {l.needsHuman && <Pill tone="bad">Precisa de você</Pill>}
        {l.aiEnabled === true && !l.needsHuman && <Pill tone="ind">IA</Pill>}
        {l.aiEnabled === false && <Pill>Humano</Pill>}
        {l.overdueTask && <Pill tone="warn">Tarefa atrasada</Pill>}
        {l.rentalDaysLeft !== null && l.rentalDaysLeft <= 30 && (
          <Pill tone={dueTone(l.rentalDaysLeft)}>
            <span suppressHydrationWarning>{dueText(l.rentalDaysLeft).replace(/^v/, "V")}</span>
          </Pill>
        )}
        {l.lostReason && <Pill tone="bad">{l.lostReason}</Pill>}
      </span>
      <span className="meta">
        {ownerName ? (
          <>
            <span className="av" aria-hidden>
              {initials(ownerName)}
            </span>
            {firstName(ownerName)}
          </>
        ) : (
          <Pill tone="warn">Sem responsável</Pill>
        )}
        <span className="r">
          <TimeAgo date={l.lastContactAt ?? l.createdAt} />
        </span>
      </span>
    </button>
  );
}
