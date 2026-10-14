"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type KeyboardEvent } from "react";
import { formatInTimeZone } from "date-fns-tz";
import { ptBR } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { useToast } from "@/components/ui/toast";
import type { Person } from "@/lib/crm/types";
import { formatBRL, TIMEZONE } from "@/lib/format";
import { firstName, initials } from "@/lib/names";
import { formatPhone } from "@/lib/phone";
import { createClient } from "@/lib/supabase/client";
import { templateCost, type TemplateCategory } from "@/lib/whatsapp/pricing";
import { CATEGORY_LABEL, fillTemplate, prefillValues, variableLabel, variableNames } from "@/lib/whatsapp/templates";
import { isWindowOpen, windowEndsAt } from "@/lib/whatsapp/window";
import { assumeConversation, markRead, sendTemplate, sendText } from "./actions";

export type InboxConversation = {
  id: string;
  assignedTo: string | null;
  aiEnabled: boolean;
  needsHuman: boolean;
  needsHumanReason: string | null;
  lastInboundAt: string | null;
  lastMessageAt: string | null;
  lastPreview: string | null;
  lastDirection: "in" | "out" | null;
  unread: number;
  numberId: string | null;
  contactName: string;
  contactPhone: string | null;
  contactOrg: string | null;
  lead: { id: string; open: boolean; stage: string | null; pipelineKey: string | null; pipelineName: string | null } | null;
};

type InboxNumber = { id: string; label: string; phone: string | null; connected: boolean };

/** Modelo aprovado pela Meta (corpo com {{1}}, {{2}}... e nomes amigáveis em variables). */
export type InboxTemplate = { id: string; name: string; category: TemplateCategory; body: string; variables: string[] };

type Props = {
  slug: string;
  companyId: string;
  conversations: InboxConversation[];
  numbers: InboxNumber[];
  people: Person[];
  viewerId: string;
  viewerName: string;
  templates: InboxTemplate[];
  manager: boolean;
  companyAi: boolean;
  initialId: string | null;
};

type Message = {
  id: string;
  direction: "in" | "out";
  sender: "contact" | "ai" | "user" | "system";
  user_id: string | null;
  msg_type: string;
  template_name: string | null;
  body: string | null;
  media_path: string | null;
  media_mime: string | null;
  status: "received" | "queued" | "sent" | "delivered" | "read" | "failed";
  source: "orvya" | "celular" | "historico";
  sent_at: string;
};

const MESSAGE_COLUMNS = "id, direction, sender, user_id, msg_type, template_name, body, media_path, media_mime, status, source, sent_at";

type Filter = "todas" | "nao-lidas" | "precisa" | "minhas" | "fila";
const FILTERS: { id: Filter; label: string }[] = [
  { id: "todas", label: "Todas" },
  { id: "nao-lidas", label: "Não lidas" },
  { id: "precisa", label: "Precisa de você" },
  { id: "minhas", label: "Minhas" },
  { id: "fila", label: "Fila" },
];

const normalize = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const hhmm = (iso: string) => formatInTimeZone(iso, TIMEZONE, "HH:mm");
const dayKey = (iso: string) => formatInTimeZone(iso, TIMEZONE, "yyyy-MM-dd");

function listTime(iso: string | null): string {
  if (!iso) return "";
  return dayKey(iso) === dayKey(new Date().toISOString()) ? hhmm(iso) : formatInTimeZone(iso, TIMEZONE, "dd/MM");
}

function dayLabel(iso: string): string {
  const today = dayKey(new Date().toISOString());
  const yesterday = dayKey(new Date(Date.now() - 86_400_000).toISOString());
  const d = dayKey(iso);
  if (d === today) return "Hoje";
  if (d === yesterday) return "Ontem";
  return formatInTimeZone(iso, TIMEZONE, "d 'de' MMMM", { locale: ptBR });
}

export function Inbox(props: Props) {
  const { slug, companyId, conversations, numbers, people, viewerId, viewerName, templates, manager, companyAi } = props;
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(props.initialId);
  const [filter, setFilter] = useState<Filter>("todas");
  const [numberFilter, setNumberFilter] = useState("");
  const [query, setQuery] = useState("");

  const numberById = useMemo(() => new Map(numbers.map((n) => [n.id, n])), [numbers]);
  const peopleById = useMemo(() => new Map(people.map((p) => [p.id, p.name])), [people]);

  // Conversas novas ou alteradas (webhook, outra pessoa da equipe): recarrega a lista.
  useEffect(() => {
    const supabase = createClient();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const channel = supabase
      .channel(`conversas-${companyId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations", filter: `company_id=eq.${companyId}` }, () => {
        clearTimeout(timer);
        timer = setTimeout(() => router.refresh(), 400);
      })
      .subscribe();
    return () => {
      clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [companyId, router]);

  const visible = useMemo(() => {
    const q = normalize(query.trim());
    const digits = query.replace(/\D/g, "");
    return conversations.filter((c) => {
      if (numberFilter && c.numberId !== numberFilter) return false;
      if (filter === "nao-lidas" && c.unread === 0) return false;
      if (filter === "precisa" && !c.needsHuman) return false;
      if (filter === "minhas" && c.assignedTo !== viewerId) return false;
      if (filter === "fila" && c.assignedTo !== null) return false;
      if (!q) return true;
      return normalize(c.contactName).includes(q) || normalize(c.contactOrg ?? "").includes(q) || (digits.length >= 3 && (c.contactPhone ?? "").includes(digits));
    });
  }, [conversations, filter, numberFilter, query, viewerId]);

  const selected = conversations.find((c) => c.id === selectedId) ?? null;

  function open(id: string) {
    setSelectedId(id);
    window.history.replaceState(null, "", `?c=${id}`);
  }

  if (conversations.length === 0) {
    return (
      <div className="empty">
        Nenhuma conversa ainda. Quando um cliente mandar mensagem para um número conectado, ela aparece aqui e o lead entra no funil.
      </div>
    );
  }

  return (
    <div className={`inbox ${selected ? "thread-open" : ""}`}>
      <aside className="conv-side" aria-label="Lista de conversas">
        <div className="conv-filter">
          <input type="search" className="inp" placeholder="Buscar nome ou telefone" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Buscar conversa" />
          <div className="flex gap-2">
            {numbers.length > 1 && (
              <select className="inp !w-auto flex-1" value={numberFilter} onChange={(e) => setNumberFilter(e.target.value)} aria-label="Número">
                <option value="">Todos os números</option>
                {numbers.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.label}
                  </option>
                ))}
              </select>
            )}
            <select className="inp !w-auto flex-1" value={filter} onChange={(e) => setFilter(e.target.value as Filter)} aria-label="Filtrar conversas">
              {FILTERS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="conv-list">
          {visible.length === 0 ? (
            <p className="m-0 p-4 text-center text-[13px] text-muted">Nenhuma conversa com esse filtro.</p>
          ) : (
            visible.map((c) => (
              <button key={c.id} type="button" className="conv" aria-current={c.id === selectedId ? "true" : undefined} onClick={() => open(c.id)}>
                <span className="av" aria-hidden>
                  {initials(c.contactName)}
                </span>
                <span className="grow">
                  <span className="l1">
                    <b>{c.contactName}</b>
                    <small suppressHydrationWarning>{listTime(c.lastMessageAt)}</small>
                  </span>
                  <p>
                    {c.lastDirection === "out" ? "Você: " : ""}
                    {c.lastPreview ?? "…"}
                  </p>
                  <span className="tags">
                    {c.unread > 0 && <span className="unread">{c.unread}</span>}
                    {c.needsHuman && <Pill tone="bad">Precisa de você</Pill>}
                    {companyAi && c.aiEnabled && !c.needsHuman && <Pill tone="ind">IA respondendo</Pill>}
                    {!c.assignedTo && <Pill tone="warn">Fila</Pill>}
                    {c.assignedTo && c.assignedTo !== viewerId && <Pill>{firstName(peopleById.get(c.assignedTo) ?? "Equipe")}</Pill>}
                    {numbers.length > 1 && c.numberId && <Pill>{numberById.get(c.numberId)?.label ?? "Número"}</Pill>}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
      </aside>

      {selected ? (
        <Thread
          key={selected.id}
          slug={slug}
          conversation={selected}
          number={selected.numberId ? (numberById.get(selected.numberId) ?? null) : null}
          peopleById={peopleById}
          viewerId={viewerId}
          viewerName={viewerName}
          templates={templates}
          manager={manager}
          onBack={() => {
            setSelectedId(null);
            window.history.replaceState(null, "", window.location.pathname);
          }}
        />
      ) : (
        <section className="thread grid place-items-center p-6 text-center text-[13px] text-muted">Escolha uma conversa na lista.</section>
      )}
    </div>
  );
}

function Thread({
  slug,
  conversation: c,
  number,
  peopleById,
  viewerId,
  viewerName,
  templates,
  manager,
  onBack,
}: {
  slug: string;
  conversation: InboxConversation;
  number: InboxNumber | null;
  peopleById: Map<string, string>;
  viewerId: string;
  viewerName: string;
  templates: InboxTemplate[];
  manager: boolean;
  onBack: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [text, setText] = useState("");
  const [sending, startSending] = useTransition();
  const [assuming, startAssuming] = useTransition();
  const [usingTemplate, setUsingTemplate] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(() => Date.now());

  // Mensagens da conversa (RLS) e novidades ao vivo pelo Realtime.
  useEffect(() => {
    const supabase = createClient();
    let alive = true;
    supabase
      .from("messages")
      .select(MESSAGE_COLUMNS)
      .eq("conversation_id", c.id)
      .order("sent_at", { ascending: false })
      .limit(300)
      .returns<Message[]>()
      .then(({ data, error }) => {
        if (!alive) return;
        if (error) setLoadError(true);
        else setMessages((data ?? []).reverse());
      });

    const channel = supabase
      .channel(`mensagens-${c.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "messages", filter: `conversation_id=eq.${c.id}` }, (payload) => {
        const row = payload.new as Message;
        if (!row?.id) return;
        setMessages((list) => {
          const current = list ?? [];
          const others = current.filter((m) => m.id !== row.id);
          return [...others, row].sort((a, b) => a.sent_at.localeCompare(b.sent_at));
        });
        if (row.direction === "in") void markRead(slug, c.id);
      })
      .subscribe();

    void markRead(slug, c.id);
    return () => {
      alive = false;
      void supabase.removeChannel(channel);
    };
  }, [c.id, slug]);

  // Relógio da janela de 24 h (atualiza a cada minuto).
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages?.length]);

  const windowOpen = isWindowOpen(c.lastInboundAt, now);
  const windowEnd = windowEndsAt(c.lastInboundAt);
  const mine = c.assignedTo === viewerId;
  const canReply = manager || !c.assignedTo || mine;
  const connected = !!number?.connected;

  const send = useCallback(() => {
    const body = text.trim();
    if (!body) return;
    startSending(async () => {
      const r = await sendText(slug, { conversationId: c.id, text: body });
      if (r.ok) {
        setText("");
        router.refresh();
      } else toast(r.error, "bad");
    });
  }, [text, slug, c.id, router, toast]);

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  const leadHref = c.lead ? `/${slug}/funil?${c.lead.pipelineKey ? `funil=${c.lead.pipelineKey}&` : ""}lead=${c.lead.id}` : null;

  return (
    <section className="thread" aria-label={`Conversa com ${c.contactName}`}>
      <header className="th-head">
        <button type="button" className="icon-btn only-mobile" onClick={onBack} aria-label="Voltar para a lista">
          <svg viewBox="0 0 24 24" aria-hidden>
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <span className="av" aria-hidden>
          {initials(c.contactName)}
        </span>
        <div className="grow">
          <b>{c.contactName}</b>
          <small>
            {[formatPhone(c.contactPhone), number?.label, c.lead?.stage && `${c.lead.pipelineName} · ${c.lead.stage}`].filter(Boolean).join(" · ")}
          </small>
        </div>
        {!mine && canReply && (
          <Button size="sm" variant="primary" loading={assuming} onClick={() => startAssuming(async () => {
            const r = await assumeConversation(slug, c.id);
            if (r.ok) {
              toast(r.message ?? "Você assumiu a conversa.", "ok");
              router.refresh();
            } else toast(r.error, "bad");
          })}>
            Assumir conversa
          </Button>
        )}
        {leadHref && (
          <Link className="btn sm" href={leadHref}>
            Ver lead
          </Link>
        )}
      </header>

      <div className="msgs" aria-live="polite">
        {c.needsHuman && c.needsHumanReason && (
          <div className="summary">
            <b>Precisa de você</b>
            {c.needsHumanReason}
          </div>
        )}
        {loadError ? (
          <p className="m-auto text-[13px] text-muted">Não foi possível carregar as mensagens. Recarregue a página.</p>
        ) : messages === null ? (
          <p className="m-auto flex items-center gap-2 text-[13px] text-muted">
            <span className="spinner" aria-hidden /> Carregando mensagens…
          </p>
        ) : messages.length === 0 ? (
          <p className="m-auto text-[13px] text-muted">Nenhuma mensagem nesta conversa ainda.</p>
        ) : (
          messages.map((m, i) => {
            const newDay = i === 0 || dayKey(messages[i - 1]!.sent_at) !== dayKey(m.sent_at);
            return (
              <MessageRow key={m.id} m={m} newDay={newDay} author={m.user_id ? (peopleById.get(m.user_id) ?? "Equipe") : null} />
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {!connected ? (
        <div className="win closed">O número desta conversa não está conectado. Veja em Canais e integrações.</div>
      ) : !canReply ? (
        <div className="win">Conversa de {firstName(peopleById.get(c.assignedTo ?? "") ?? "outro vendedor")}. Você pode acompanhar, mas não responder.</div>
      ) : !windowOpen ? (
        <>
          <div className="win closed">A janela de 24 horas fechou. Pela regra da Meta, só é possível enviar um modelo aprovado até o cliente responder.</div>
          <TemplateComposer
            slug={slug}
            conversationId={c.id}
            contactName={c.contactName}
            viewerName={viewerName}
            templates={templates}
            manager={manager}
            onSent={() => router.refresh()}
          />
        </>
      ) : usingTemplate ? (
        <>
          <div className="win" suppressHydrationWarning>
            Janela aberta até {windowEnd ? formatInTimeZone(windowEnd, TIMEZONE, "dd/MM 'às' HH:mm") : ""}. Enviando modelo de mensagem.
            <button type="button" className="ml-auto underline" onClick={() => setUsingTemplate(false)}>
              Voltar ao texto livre
            </button>
          </div>
          <TemplateComposer
            slug={slug}
            conversationId={c.id}
            contactName={c.contactName}
            viewerName={viewerName}
            templates={templates}
            manager={manager}
            onSent={() => {
              setUsingTemplate(false);
              router.refresh();
            }}
          />
        </>
      ) : (
        <>
          <div className="win" suppressHydrationWarning>
            Janela aberta até {windowEnd ? formatInTimeZone(windowEnd, TIMEZONE, "dd/MM 'às' HH:mm") : ""}. Mensagens livres sem custo.
            {templates.length > 0 && (
              <button type="button" className="ml-auto underline" onClick={() => setUsingTemplate(true)}>
                Usar modelo
              </button>
            )}
          </div>
          <div className="composer">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={`Responder ${firstName(c.contactName)}… (Enter envia, Shift+Enter quebra linha)`}
              aria-label="Mensagem"
              rows={1}
              maxLength={4096}
              disabled={sending}
            />
            <Button variant="primary" loading={sending} disabled={!text.trim()} onClick={send}>
              Enviar
            </Button>
          </div>
        </>
      )}
    </section>
  );
}

const STATUS_TEXT: Record<Message["status"], string> = {
  received: "",
  queued: "na fila",
  sent: "✓ enviada",
  delivered: "✓✓ entregue",
  read: "✓✓ lida",
  failed: "não enviada",
};

function MessageRow({ m, newDay, author }: { m: Message; newDay: boolean; author: string | null }) {
  const kind = m.direction === "in" ? "lead" : m.sender === "ai" ? "ai" : m.source === "celular" ? "phone" : m.sender === "system" ? "lead" : "human";
  const media = m.media_path ? `/api/media/${m.id}` : null;
  // O corpo de mídia vem como "[Imagem] legenda": com o arquivo na tela, mostra só a legenda.
  const body = media ? (m.body ?? "").replace(/^\[[^\]]+\]\s*/, "") : m.body;
  const who = m.direction === "in" ? null : m.sender === "ai" ? "IA" : m.source === "celular" ? "pelo celular" : m.source === "historico" ? "histórico" : author;

  return (
    <>
      {newDay && (
        <span className="day-sep" suppressHydrationWarning>
          {dayLabel(m.sent_at)}
        </span>
      )}
      <div className={`bub ${kind} ${m.msg_type === "template" ? "tpl" : ""} ${m.status === "failed" ? "failed" : ""}`}>
        {media && m.media_mime?.startsWith("image/") && (
          // eslint-disable-next-line @next/next/no-img-element -- URL assinada e temporária, servida pelo Supabase
          <img src={media} alt="Imagem enviada na conversa" loading="lazy" />
        )}
        {media && m.media_mime?.startsWith("audio/") && <audio controls preload="none" src={media} />}
        {media && m.media_mime?.startsWith("video/") && <video controls preload="none" src={media} className="max-h-[280px] max-w-full rounded-[10px]" />}
        {media && !/^(image|audio|video)\//.test(m.media_mime ?? "") && (
          <a href={media} target="_blank" rel="noreferrer">
            Abrir documento
          </a>
        )}
        {body}
        <small suppressHydrationWarning>
          {[who, m.template_name ? `modelo ${m.template_name}` : "", hhmm(m.sent_at), m.direction === "out" ? STATUS_TEXT[m.status] : ""].filter(Boolean).join(" · ")}
        </small>
      </div>
    </>
  );
}

/** Valor inicial dos campos: nome = primeiro nome do cliente; vendedor = primeiro nome de quem está logado. */
function defaultValues(t: InboxTemplate, contactName: string, viewerName: string): string[] {
  return prefillValues(t.body, t.variables, { contactName, sellerName: viewerName });
}

function TemplateComposer({
  slug,
  conversationId,
  contactName,
  viewerName,
  templates,
  manager,
  onSent,
}: {
  slug: string;
  conversationId: string;
  contactName: string;
  viewerName: string;
  templates: InboxTemplate[];
  manager: boolean;
  onSent: () => void;
}) {
  const toast = useToast();
  const [pickId, setPickId] = useState(templates[0]?.id ?? "");
  const t = templates.find((x) => x.id === pickId) ?? null;
  const [values, setValues] = useState<string[]>(() => (t ? defaultValues(t, contactName, viewerName) : []));
  const [sending, startSending] = useTransition();

  if (!t) {
    return (
      <p className="ai-note pt-2.5">
        Nenhum modelo aprovado.{" "}
        {manager ? (
          <Link className="underline" href={`/${slug}/config/canais`}>
            Crie um em Canais e integrações.
          </Link>
        ) : (
          "Peça ao gestor para criar um modelo em Canais e integrações."
        )}
      </p>
    );
  }

  const names = variableNames(t.body, t.variables);
  const complete = values.length === names.length && values.every((v) => v.trim());
  const preview = fillTemplate(t.body, names, values);

  function pick(id: string) {
    setPickId(id);
    const next = templates.find((x) => x.id === id);
    setValues(next ? defaultValues(next, contactName, viewerName) : []);
  }

  function send() {
    if (!t || !complete) return;
    startSending(async () => {
      const r = await sendTemplate(slug, { conversationId, templateId: t.id, values });
      if (r.ok) {
        toast(r.message ?? "Modelo enviado.", "ok");
        onSent();
      } else toast(r.error, "bad");
    });
  }

  return (
    <div className="composer tpl-composer">
      <select className="inp" value={pickId} onChange={(e) => pick(e.target.value)} aria-label="Modelo de mensagem" disabled={sending}>
        {templates.map((x) => (
          <option key={x.id} value={x.id}>
            {x.name} ({CATEGORY_LABEL[x.category]})
          </option>
        ))}
      </select>
      {names.length > 0 && (
        <div className="tpl-fields">
          {names.map((n, i) => (
            <TextField
              key={`${t.id}-${n}-${i}`}
              label={variableLabel(n)}
              value={values[i] ?? ""}
              onChange={(e) => setValues((list) => list.map((v, j) => (j === i ? e.target.value : v)))}
              maxLength={200}
              disabled={sending}
              placeholder={n === "produto" ? "Ex.: cadeira de rodas" : undefined}
            />
          ))}
        </div>
      )}
      <div className="tpl-prev" aria-label="Prévia da mensagem">
        {preview}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex-1 text-[11.5px] text-muted">
          Custo estimado deste envio: {formatBRL(templateCost(t.category))} (categoria {CATEGORY_LABEL[t.category]}, valor aproximado).
          {!complete && " Preencha todos os campos."}
        </span>
        <Button variant="primary" loading={sending} disabled={!complete} onClick={send}>
          Enviar modelo
        </Button>
      </div>
    </div>
  );
}
