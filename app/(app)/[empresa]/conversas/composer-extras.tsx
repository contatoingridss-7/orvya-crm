"use client";

import { useEffect, useMemo, useState, useTransition, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { quickReplyUsed, searchProducts, sendMaterial, sendProduct } from "./actions";

export type QuickReply = { id: string; shortcut: string; body: string; uses: number };
export type Material = { id: string; title: string; fileName: string; kind: "pdf" | "imagem" };

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const first = (name: string) => name.trim().split(/\s+/)[0] ?? "";

/** {nome} = primeiro nome do cliente; {vendedor} = primeiro nome de quem envia. */
export function fillQuickReply(body: string, contactName: string, viewerName: string) {
  return body.replaceAll("{nome}", first(contactName)).replaceAll("{vendedor}", first(viewerName));
}

/**
 * Respostas rápidas: com o texto começando por "/", mostra as respostas (as mais usadas primeiro),
 * filtrando pelo que vem depois da barra. Setas escolhem; Enter ou Tab colocam o texto na caixa.
 */
export function useQuickReplies(opts: {
  slug: string;
  text: string;
  setText: (t: string) => void;
  replies: QuickReply[];
  contactName: string;
  viewerName: string;
}) {
  const { slug, text, setText, replies, contactName, viewerName } = opts;
  const [index, setIndex] = useState(0);
  const [closedFor, setClosedFor] = useState<string | null>(null);
  const query = text.startsWith("/") && !text.includes("\n") ? norm(text.slice(1).trim()) : null;

  const matches = useMemo(() => {
    if (query === null) return [];
    return replies
      .filter((r) => !query || r.shortcut.includes(query) || norm(r.body).includes(query))
      .sort((a, b) => Number(b.shortcut.startsWith(query)) - Number(a.shortcut.startsWith(query)) || b.uses - a.uses || a.shortcut.localeCompare(b.shortcut))
      .slice(0, 8);
  }, [query, replies]);
  const open = query !== null && matches.length > 0 && closedFor !== text;

  useEffect(() => setIndex(0), [query]);

  function pick(r: QuickReply) {
    setText(fillQuickReply(r.body, contactName, viewerName));
    void quickReplyUsed(slug, r.id);
  }

  /** Devolve true quando a tecla foi usada pelo menu (aí a caixa não envia). */
  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): boolean {
    if (!open) return false;
    if (e.key === "ArrowDown") setIndex((i) => (i + 1) % matches.length);
    else if (e.key === "ArrowUp") setIndex((i) => (i - 1 + matches.length) % matches.length);
    else if (e.key === "Enter" || e.key === "Tab") pick(matches[index]!);
    else if (e.key === "Escape") setClosedFor(text);
    else return false;
    e.preventDefault();
    return true;
  }

  const menu = open ? (
    <div className="qr-menu" role="listbox" aria-label="Respostas rápidas">
      {matches.map((r, i) => (
        <button
          key={r.id}
          type="button"
          role="option"
          aria-selected={i === index}
          className={i === index ? "on" : ""}
          onMouseDown={(e) => {
            e.preventDefault();
            pick(r);
          }}
          onMouseEnter={() => setIndex(i)}
        >
          <b>/{r.shortcut}</b>
          <span>{fillQuickReply(r.body, contactName, viewerName)}</span>
        </button>
      ))}
      <small>↑ ↓ escolhe · Enter usa · Esc fecha</small>
    </div>
  ) : null;

  return { menu, onKeyDown, hasReplies: replies.length > 0 };
}

/** Anexar: material da empresa (PDF ou imagem) ou produto do catálogo (foto com nome e preço). */
export function AttachButton({ slug, conversationId, materials, onSent }: { slug: string; conversationId: string; materials: Material[]; onSent: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"materiais" | "produto">(materials.length ? "materiais" : "produto");
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<Awaited<ReturnType<typeof searchProducts>>>([]);
  const [searching, startSearch] = useTransition();
  const [sending, startSend] = useTransition();

  useEffect(() => {
    if (tab !== "produto" || term.trim().length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(() => startSearch(async () => setResults(await searchProducts(slug, term))), 300);
    return () => clearTimeout(t);
  }, [term, tab, slug]);

  function send(fn: () => Promise<{ ok: true } | { ok: false; error: string }>, what: string) {
    startSend(async () => {
      const r = await fn();
      if (r.ok) {
        toast(`${what} enviado.`, "ok");
        setOpen(false);
        onSent();
      } else toast(r.error, "bad");
    });
  }

  return (
    <>
      <Button aria-label="Enviar catálogo, material ou produto" title="Enviar catálogo, material ou produto" onClick={() => setOpen(true)}>
        Anexar
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Enviar para o cliente">
        <nav className="tabs mb-3" aria-label="O que enviar">
          <button type="button" aria-current={tab === "materiais" ? "page" : undefined} onClick={() => setTab("materiais")}>
            Catálogos e materiais
          </button>
          <button type="button" aria-current={tab === "produto" ? "page" : undefined} onClick={() => setTab("produto")}>
            Produto do catálogo
          </button>
        </nav>

        {tab === "materiais" ? (
          materials.length === 0 ? (
            <p className="m-0 text-[13px] text-muted">Nenhum material cadastrado. O gestor inclui os PDFs em Configurações → Automações → Materiais.</p>
          ) : (
            <ul className="m-0 grid max-h-[50vh] list-none gap-2 overflow-auto p-0">
              {materials.map((m) => (
                <li key={m.id} className="flex items-center gap-3 rounded-xl border border-line px-3 py-2">
                  <span className="min-w-0 flex-1">
                    <b className="block truncate font-semibold text-title">{m.title}</b>
                    <small className="text-xs text-muted">
                      {m.kind === "pdf" ? "PDF" : "Imagem"} · {m.fileName}
                    </small>
                  </span>
                  <Button size="sm" variant="primary" disabled={sending} onClick={() => send(() => sendMaterial(slug, { conversationId, id: m.id }), "Material")}>
                    Enviar
                  </Button>
                </li>
              ))}
            </ul>
          )
        ) : (
          <div className="grid gap-2">
            <input className="inp" autoFocus value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Nome ou código do produto" aria-label="Buscar produto" />
            {searching && <small className="text-muted">Buscando…</small>}
            {!searching && term.trim().length >= 2 && results.length === 0 && <small className="text-muted">Nenhum produto encontrado.</small>}
            <ul className="m-0 grid max-h-[45vh] list-none gap-2 overflow-auto p-0">
              {results.map((p) => (
                <li key={p.id} className="flex items-center gap-3 rounded-xl border border-line px-3 py-2">
                  <span className="min-w-0 flex-1">
                    <b className="block truncate font-semibold text-title">{p.label}</b>
                    <small className="text-xs text-muted">
                      {p.price ?? "Sem preço no catálogo"} · {p.hasPhoto ? "com foto" : "sem foto (vai só o texto)"}
                    </small>
                  </span>
                  <Button size="sm" variant="primary" disabled={sending} onClick={() => send(() => sendProduct(slug, { conversationId, id: p.id }), "Produto")}>
                    Enviar
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <p className="mt-3 mb-0 text-[12px] text-muted">Vai como mensagem do WhatsApp, sem custo, dentro da janela de 24 horas.</p>
      </Modal>
    </>
  );
}
