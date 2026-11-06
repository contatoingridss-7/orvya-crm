"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type KeyboardEvent } from "react";
import { formatInTimeZone } from "date-fns-tz";
import { ptBR } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
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
import { instagramWindow, instagramWindowEndsAt, IG_WINDOW_MS } from "@/lib/instagram/window";
import { isWindowOpen, windowEndsAt } from "@/lib/whatsapp/window";
import { AttachButton, AudioRecorder, EmojiButton, useQuickReplies, type Material, type QuickReply } from "./composer-extras";
import { assumeConversation, correctMessage, markRead, removeFromCrm, resendMessage, sendTemplate, sendText } from "./actions";

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
  channel: "whatsapp" | "instagram";
  numberId: string | null;
  igAccountId: string | null;
  /** @ do Instagram (conversas do Direct). */
  contactHandle: string | null;
  contactName: string;
  contactPhone: string | null;
  contactOrg: string | null;
  lead: { id: string; open: boolean; stage: string | null; pipelineKey: string | null; pipelineName: string | null } | null;
};

type InboxNumber = { id: string; label: string; phone: string | null; connected: boolean };
type InboxIgAccount = { id: string; username: string | null; connected: boolean };

/** Valor do filtro de canal para as conversas do Instagram (os demais são ids de número). */
const IG_FILTER = "instagram";

/** Modelo aprovado pela Meta (corpo com {{1}}, {{2}}... e nomes amigáveis em variables). */
export type InboxTemplate = { id: string; name: string; category: TemplateCategory; body: string; variables: string[] };

type Props = {
  slug: string;
  companyId: string;
  conversations: InboxConversation[];
  numbers: InboxNumber[];
  igAccounts: InboxIgAccount[];
  people: Person[];
  viewerId: string;
  viewerName: string;
  templates: InboxTemplate[];
  manager: boolean;
  companyAi: boolean;
  initialId: string | null;
  quickReplies: QuickReply[];
  materials: Material[];
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

type Filter = "todas" | "nao-lidas" | "precisa" | "minhas" | "fila" | "finalizadas";
const FILTERS: { id: Filter; label: string }[] = [
  { id: "todas", label: "Todas" },
  { id: "nao-lidas", label: "Não lidas" },
  { id: "precisa", label: "Precisa de você" },
  { id: "minhas", label: "Minhas" },
  { id: "fila", label: "Fila" },
  { id: "finalizadas", label: "Finalizadas (venda ou perda)" },
];

/** Lead ganho ou perdido: a conversa sai da lista e fica em "Finalizadas" até o cliente escrever de novo (abre lead novo). */
const finished = (c: { lead: { open: boolean } | null }) => !!c.lead && !c.lead.open;

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
  const { slug, companyId, conversations, numbers, igAccounts, people, viewerId, viewerName, templates, manager, companyAi, quickReplies, materials } = props;
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
      if (numberFilter === IG_FILTER ? c.channel !== "instagram" : numberFilter && c.numberId !== numberFilter) return false;
      if (filter === "finalizadas" ? !finished(c) : finished(c)) return false;
      if (filter === "nao-lidas" && c.unread === 0) return false;
      if (filter === "precisa" && !c.needsHuman) return false;
      if (filter === "minhas" && c.assignedTo !== viewerId) return false;
      if (filter === "fila" && c.assignedTo !== null) return false;
      if (!q) return true;
      return (
        normalize(c.contactName).includes(q) ||
        normalize(c.contactOrg ?? "").includes(q) ||
        normalize(c.contactHandle ?? "").includes(q.replace(/^@/, "")) ||
        (digits.length >= 3 && (c.contactPhone ?? "").includes(digits))
      );
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
          <div className="flex min-w-0 gap-2">
            {(numbers.length > 1 || igAccounts.length > 0) && (
              <select className="inp !w-auto min-w-0 flex-1" value={numberFilter} onChange={(e) => setNumberFilter(e.target.value)} aria-label="Canal">
                <option value="">{igAccounts.length ? "Todos os canais" : "Todos os números"}</option>
                {numbers.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.label}
                  </option>
                ))}
                {igAccounts.length > 0 && <option value={IG_FILTER}>Instagram</option>}
              </select>
            )}
            <select className="inp !w-auto min-w-0 flex-1" value={filter} onChange={(e) => setFilter(e.target.value as Filter)} aria-label="Filtrar conversas">
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
                    {c.channel === "instagram" ? (
                      <Pill tone="ind">Instagram</Pill>
                    ) : (
                      numbers.length > 1 && c.numberId && <Pill>{numberById.get(c.numberId)?.label ?? "Número"}</Pill>
                    )}
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
          igAccount={selected.igAccountId ? (igAccounts.find((a) => a.id === selected.igAccountId) ?? null) : null}
          peopleById={peopleById}
          viewerId={viewerId}
          viewerName={viewerName}
          templates={templates}
          manager={manager}
          quickReplies={quickReplies}
          materials={materials}
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
  igAccount,
  peopleById,
  viewerId,
  viewerName,
  templates,
  manager,
  quickReplies,
  materials,
  onBack,
}: {
  slug: string;
  conversation: InboxConversation;
  number: InboxNumber | null;
  igAccount: InboxIgAccount | null;
  peopleById: Map<string, string>;
  viewerId: string;
  viewerName: string;
  templates: InboxTemplate[];
  manager: boolean;
  quickReplies: QuickReply[];
  materials: Material[];
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
  const [correcting, setCorrecting] = useState<{ id: string; text: string } | null>(null);
  const [fixing, startFixing] = useTransition();
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
  const isIg = c.channel === "instagram";
  const connected = isIg ? !!igAccount?.connected : !!number?.connected;
  // Direct: resposta livre até 24 h; da equipe até 7 dias (etiqueta de atendimento humano). Sem modelos.
  const igWindow = isIg ? instagramWindow(c.lastInboundAt, now) : null;
  const igEnd = isIg && c.lastInboundAt ? instagramWindowEndsAt(c.lastInboundAt) : null;
  const igFreeEnd = isIg && c.lastInboundAt ? new Date(new Date(c.lastInboundAt).getTime() + IG_WINDOW_MS) : null;

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

  // Emoji entra onde está o cursor da caixa de mensagem.
  const taRef = useRef<HTMLTextAreaElement>(null);
  function insertEmoji(emoji: string) {
    const el = taRef.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    setText((t) => t.slice(0, start) + emoji + t.slice(end));
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.selectionStart = el.selectionEnd = start + emoji.length;
    });
  }

  // Foto ou vídeo colado (Ctrl+V) abre a prévia de envio do Anexar.
  const [pasted, setPasted] = useState<File | null>(null);
  const clearPasted = useCallback(() => setPasted(null), []);

  // "/" na caixa de texto abre as respostas rápidas.
  const qr = useQuickReplies({ slug, text, setText, replies: quickReplies, contactName: c.contactName, viewerName });

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (qr.onKeyDown(e)) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  const leadHref = c.lead ? `/${slug}/funil?${c.lead.pipelineKey ? `funil=${c.lead.pipelineKey}&` : ""}lead=${c.lead.id}` : null;

  return (
    <section className="thread" aria-label={`Conversa com ${c.contactName}`}>
      <Modal
        open={!!correcting}
        onClose={() => setCorrecting(null)}
        title="Corrigir mensagem"
        actions={
          <>
            <Button onClick={() => setCorrecting(null)}>Cancelar</Button>
            <Button
              variant="primary"
              loading={fixing}
              disabled={!correcting?.text.trim()}
              onClick={() =>
                correcting &&
                startFixing(async () => {
                  const r = await correctMessage(slug, { messageId: correcting.id, text: correcting.text });
                  if (r.ok) {
                    toast(r.message ?? "Correção enviada.", "ok");
                    setCorrecting(null);
                    router.refresh();
                  } else toast(r.error, "bad");
                })
              }
            >
              Enviar correção
            </Button>
          </>
        }
      >
        <p className="mt-0 text-[12.5px] text-muted">
          O WhatsApp não deixa editar mensagem já enviada. A correção vai como nova mensagem, respondendo em cima da original, com “Correção:” na frente.
        </p>
        <textarea
          className="inp min-h-[96px] w-full"
          value={correcting?.text ?? ""}
          onChange={(e) => setCorrecting((c) => (c ? { ...c, text: e.target.value } : c))}
          maxLength={4096}
          aria-label="Texto corrigido"
          autoFocus
        />
      </Modal>
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
            {[
              isIg ? (c.contactHandle ? `@${c.contactHandle} · Instagram` : "Instagram") : formatPhone(c.contactPhone),
              isIg ? null : number?.label,
              c.lead?.stage && `${c.lead.pipelineName} · ${c.lead.stage}`,
            ]
              .filter(Boolean)
              .join(" · ")}
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
        {manager && (
          <Button
            size="sm"
            variant="ghost"
            loading={assuming}
            title="Para equipe, sócios, parceiros e testes: a conversa e o lead saem do Orvya"
            onClick={() => {
              const detail = isIg
                ? "As próximas mensagens dele ficam só no Instagram."
                : "Se ele escrever de novo no WhatsApp, volta como contato novo.";
              if (!window.confirm(`Tirar ${c.contactName} do Orvya? A conversa e o lead aberto sem produto serão excluídos. ${detail}`)) return;
              startAssuming(async () => {
                const r = await removeFromCrm(slug, c.id);
                if (r.ok) {
                  toast(r.message ?? "Contato tirado do Orvya.", "ok");
                  onBack();
                  router.refresh();
                } else toast(r.error, "bad");
              });
            }}
          >
            Tirar do Orvya
          </Button>
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
              <MessageRow
                key={m.id}
                m={m}
                newDay={newDay}
                author={m.user_id ? (peopleById.get(m.user_id) ?? "Equipe") : null}
                onResend={
                  m.direction === "out" && m.status === "failed" && m.msg_type !== "template"
                    ? async () => {
                        const r = await resendMessage(slug, m.id);
                        if (r.ok) {
                          toast(r.message ?? "Mensagem reenviada.", "ok");
                          setMessages((list) => list?.map((x) => (x.id === m.id ? { ...x, status: "sent" } : x)) ?? list);
                        } else toast(r.error, "bad");
                      }
                    : undefined
                }
                onCorrect={
                  !isIg && m.direction === "out" && m.sender === "user" && m.msg_type === "text" && m.status !== "failed" && windowOpen
                    ? () => setCorrecting({ id: m.id, text: (m.body ?? "").replace(/^\*Correção:\* /, "") })
                    : undefined
                }
              />
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {!connected ? (
        <div className="win closed">
          {isIg ? "O Instagram desta empresa não está conectado. Veja em Canais e integrações." : "O número desta conversa não está conectado. Veja em Canais e integrações."}
        </div>
      ) : !canReply ? (
        <div className="win">Conversa de {firstName(peopleById.get(c.assignedTo ?? "") ?? "outro vendedor")}. Você pode acompanhar, mas não responder.</div>
      ) : isIg ? (
        igWindow === "closed" ? (
          <div className="win closed">
            Pela regra do Instagram, só dá para responder até 7 dias depois da última mensagem do cliente. Quando ele escrever de novo, a conversa reabre.
          </div>
        ) : (
          <>
            <div className="win" suppressHydrationWarning>
              {igWindow === "open"
                ? `Resposta livre até ${igFreeEnd ? formatInTimeZone(igFreeEnd, TIMEZONE, "dd/MM 'às' HH:mm") : ""}.`
                : `Passou de 24 horas: a resposta vai como atendimento da equipe, permitido até ${igEnd ? formatInTimeZone(igEnd, TIMEZONE, "dd/MM 'às' HH:mm") : ""}.`}
            </div>
            <div className="composer">
              <EmojiButton onPick={insertEmoji} disabled={sending} />
              <div className="qr-wrap">
                {qr.menu}
                <textarea
                ref={taRef}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder={`Responder ${firstName(c.contactName)} no Direct… (Enter envia, Shift+Enter quebra linha)`}
                aria-label="Mensagem"
                rows={1}
                maxLength={1000}
                disabled={sending}
              />
              </div>
              <Button variant="primary" loading={sending} disabled={!text.trim()} onClick={send}>
                Enviar
              </Button>
            </div>
          </>
        )
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
            <AttachButton slug={slug} conversationId={c.id} materials={materials} onSent={() => router.refresh()} pasted={pasted} onPastedHandled={clearPasted} />
            <AudioRecorder slug={slug} conversationId={c.id} onSent={() => router.refresh()} />
            <EmojiButton onPick={insertEmoji} disabled={sending} />
            <div className="qr-wrap">
              {qr.menu}
              <textarea
              ref={taRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKeyDown}
              onPaste={(e) => {
                const f = Array.from(e.clipboardData.files).find((x) => /^(image|video|audio)\//.test(x.type));
                if (!f) return;
                e.preventDefault();
                setPasted(f);
              }}
              placeholder={`Responder ${firstName(c.contactName)}… (/ para respostas rápidas, Ctrl+V cola foto ou vídeo)`}
              aria-label="Mensagem"
              rows={1}
              maxLength={4096}
              disabled={sending}
            />
            </div>
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

function MessageRow({
  m,
  newDay,
  author,
  onResend,
  onCorrect,
}: {
  m: Message;
  newDay: boolean;
  author: string | null;
  onResend?: () => Promise<void>;
  onCorrect?: () => void;
}) {
  const [resending, setResending] = useState(false);
  const kind = m.direction === "in" ? "lead" : m.sender === "ai" ? "ai" : m.source === "celular" ? "phone" : "human";
  const media = m.media_path ? `/api/media/${m.id}` : null;
  // O corpo de mídia vem como "[Imagem] legenda": com o arquivo na tela, mostra só a legenda.
  const body = media ? (m.body ?? "").replace(/^\[[^\]]+\]\s*/, "") : m.body;
  // Respostas automáticas (fora do horário, boas-vindas do Instagram) aparecem do lado da empresa.
  const who = m.direction === "in" ? null : m.sender === "ai" ? "IA" : m.sender === "system" ? "resposta automática" : m.source === "celular" ? "pelo celular" : m.source === "historico" ? "histórico" : author;

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
          {onCorrect && (
            <>
              {" · "}
              <button type="button" className="underline" onClick={onCorrect}>
                Corrigir
              </button>
            </>
          )}
          {onResend && (
            <>
              {" · "}
              <button
                type="button"
                className="font-semibold underline"
                disabled={resending}
                onClick={async () => {
                  setResending(true);
                  try {
                    await onResend();
                  } finally {
                    setResending(false);
                  }
                }}
              >
                {resending ? "reenviando…" : "Reenviar"}
              </button>
            </>
          )}
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
