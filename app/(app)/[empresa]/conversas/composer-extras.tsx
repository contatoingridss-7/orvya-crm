"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { createClient } from "@/lib/supabase/client";
import { prepareVideoUpload, quickReplyUsed, searchProducts, sendAudio, sendMaterial, sendPhoto, sendProduct, sendUploadedVideo } from "./actions";

export type QuickReply = { id: string; shortcut: string; body: string; uses: number; materialIds?: string[]; withMenu?: boolean };
export type Material = { id: string; title: string; fileName: string; kind: "pdf" | "imagem" | "audio" };

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
  /** Imagens da resposta escolhida (vão junto no envio). */
  onAttach?: (materialIds: string[], withMenu: boolean) => void;
}) {
  const { slug, text, setText, replies, contactName, viewerName, onAttach } = opts;
  const [index, setIndex] = useState(0);
  const [closedFor, setClosedFor] = useState<string | null>(null);
  const query = text.startsWith("/") && !text.includes("\n") ? norm(text.slice(1).trim()) : null;

  const matches = useMemo(() => {
    if (query === null) return [];
    // Só "/": todas as respostas, em ordem alfabética (o menu rola). Digitando: as que combinam, as mais usadas primeiro.
    if (!query) return [...replies].sort((a, b) => a.shortcut.localeCompare(b.shortcut));
    return replies
      .filter((r) => r.shortcut.includes(query) || norm(r.body).includes(query))
      .sort((a, b) => Number(b.shortcut.startsWith(query)) - Number(a.shortcut.startsWith(query)) || b.uses - a.uses || a.shortcut.localeCompare(b.shortcut));
  }, [query, replies]);
  const open = query !== null && matches.length > 0 && closedFor !== text;
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => setIndex(0), [query]);
  // Com as setas, a opção escolhida acompanha a rolagem do menu.
  useEffect(() => {
    menuRef.current?.querySelector("button.on")?.scrollIntoView({ block: "nearest" });
  }, [index, open]);

  function pick(r: QuickReply) {
    setText(fillQuickReply(r.body, contactName, viewerName));
    onAttach?.(r.materialIds ?? [], r.withMenu ?? false);
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
    <div ref={menuRef} className="qr-menu" role="listbox" aria-label="Respostas rápidas">
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

/** Converte no servidor para mensagem de voz do WhatsApp (OGG/Opus). */
export async function convertToVoice(blob: Blob): Promise<Blob> {
  const res = await fetch("/api/audio/voz", { method: "POST", headers: { "content-type": blob.type || "audio/webm" }, body: blob });
  if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { erro?: string } | null)?.erro ?? "Não foi possível converter o áudio.");
  return res.blob();
}

async function sendVoice(slug: string, conversationId: string, blob: Blob): Promise<{ ok: true } | { ok: false; error: string }> {
  let ogg: Blob;
  try {
    ogg = await convertToVoice(blob);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Não foi possível converter o áudio." };
  }
  const fd = new FormData();
  fd.set("conversationId", conversationId);
  fd.set("file", new File([ogg], "audio.ogg", { type: "audio/ogg" }));
  return sendAudio(slug, fd);
}

const REC_MAX_S = 240;
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/** Gravar áudio na conversa: grava, ouve antes e envia como mensagem de voz. */
export function AudioRecorder({ slug, conversationId, onSent }: { slug: string; conversationId: string; onSent: () => void }) {
  const toast = useToast();
  const [state, setState] = useState<"idle" | "rec" | "ready">("idle");
  const [seconds, setSeconds] = useState(0);
  const [clip, setClip] = useState<{ blob: Blob; url: string } | null>(null);
  const [sending, startSend] = useTransition();
  const recRef = useRef<MediaRecorder | null>(null);
  const discardRef = useRef(false);

  useEffect(() => {
    if (state !== "rec") return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [state]);

  useEffect(() => {
    if (state === "rec" && seconds >= REC_MAX_S) recRef.current?.stop();
  }, [seconds, state]);

  async function start() {
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      toast("Este navegador não grava áudio. Use o Chrome, o Safari ou o Edge atualizados.", "bad");
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      toast("Libere o microfone para o Orvya no navegador e tente de novo.", "bad");
      return;
    }
    const mime = ["audio/ogg;codecs=opus", "audio/webm;codecs=opus", "audio/mp4"].find((m) => MediaRecorder.isTypeSupported(m));
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const chunks: Blob[] = [];
    discardRef.current = false;
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      if (discardRef.current) return setState("idle");
      const blob = new Blob(chunks, { type: rec.mimeType || mime || "audio/webm" });
      setClip({ blob, url: URL.createObjectURL(blob) });
      setState("ready");
    };
    recRef.current = rec;
    setSeconds(0);
    rec.start();
    setState("rec");
  }

  function reset() {
    if (clip) URL.revokeObjectURL(clip.url);
    setClip(null);
    setState("idle");
  }

  if (state === "rec") {
    return (
      <span className="flex items-center gap-2 text-[13px]" role="status">
        <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: "var(--lost)" }} aria-hidden />
        <span className="tabular-nums">Gravando {mmss(seconds)}</span>
        <Button size="sm" variant="primary" onClick={() => recRef.current?.stop()}>
          Parar
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            discardRef.current = true;
            recRef.current?.stop();
          }}
        >
          Cancelar
        </Button>
      </span>
    );
  }
  if (state === "ready" && clip) {
    return (
      <span className="flex flex-wrap items-center gap-2">
        <audio controls src={clip.url} className="h-9 max-w-[220px]" />
        <Button
          size="sm"
          variant="primary"
          loading={sending}
          onClick={() =>
            startSend(async () => {
              const r = await sendVoice(slug, conversationId, clip.blob);
              if (r.ok) {
                toast("Áudio enviado.", "ok");
                reset();
                onSent();
              } else toast(r.error, "bad");
            })
          }
        >
          Enviar áudio
        </Button>
        <Button size="sm" variant="ghost" disabled={sending} onClick={reset}>
          Descartar
        </Button>
      </span>
    );
  }
  return (
    <Button aria-label="Gravar áudio" title="Gravar áudio" onClick={start}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <rect x="9" y="3" width="6" height="12" rx="3" />
        <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
      </svg>
    </Button>
  );
}

/** Reduz a foto (lado maior 1600 px, JPG) para caber no envio e carregar rápido no WhatsApp do cliente. */
async function shrinkPhoto(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("foto"))), "image/jpeg", 0.82));
}

/** Anexar: foto ou vídeo (escolhido ou colado com Ctrl+V), material da empresa ou produto do catálogo. */
export function AttachButton({
  slug,
  conversationId,
  materials,
  onSent,
  pasted,
  onPastedHandled,
}: {
  slug: string;
  conversationId: string;
  materials: Material[];
  onSent: () => void;
  /** Arquivo colado na caixa de mensagem: abre direto a prévia de envio. */
  pasted?: File | null;
  onPastedHandled?: () => void;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"midia" | "materiais" | "produto">("midia");
  const [media, setMedia] = useState<{ kind: "image" | "video" | "audio"; blob: Blob; mime: string; url: string } | null>(null);
  const [caption, setCaption] = useState("");
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

  /** Foto é reduzida aqui; vídeo vai como está (até 16 MB, limite do WhatsApp). */
  const loadFile = useCallback(
    async (f: File) => {
      const swap = (next: { kind: "image" | "video" | "audio"; blob: Blob; mime: string }) =>
        setMedia((old) => {
          if (old) URL.revokeObjectURL(old.url);
          return { ...next, url: URL.createObjectURL(next.blob) };
        });
      if (f.type.startsWith("video/")) {
        if (!["video/mp4", "video/3gpp", "video/quicktime"].includes(f.type)) return toast("Envie o vídeo em MP4 (o formato da câmera do celular).", "bad");
        if (f.size > 16 * 1024 * 1024) return toast("Vídeo grande demais: o WhatsApp aceita até 16 MB.", "bad");
        return swap({ kind: "video", blob: f, mime: f.type });
      }
      if (f.type.startsWith("audio/")) {
        if (f.size > 4 * 1024 * 1024) return toast("Áudio grande demais (máximo de 4 MB).", "bad");
        return swap({ kind: "audio", blob: f, mime: f.type });
      }
      if (!f.type.startsWith("image/")) return toast("Escolha uma foto, um vídeo ou um áudio.", "bad");
      try {
        swap({ kind: "image", blob: await shrinkPhoto(f), mime: "image/jpeg" });
      } catch {
        toast("Não foi possível abrir esta imagem. Use uma foto em JPG ou PNG.", "bad");
      }
    },
    [toast],
  );

  useEffect(() => {
    if (!pasted) return;
    setTab("midia");
    setOpen(true);
    void loadFile(pasted);
    onPastedHandled?.();
  }, [pasted, loadFile, onPastedHandled]);

  function send(fn: () => Promise<{ ok: true } | { ok: false; error: string }>, what: string) {
    startSend(async () => {
      const r = await fn();
      if (r.ok) {
        toast(`${what} enviado.`, "ok");
        setOpen(false);
        setMedia(null);
        setCaption("");
        onSent();
      } else toast(r.error, "bad");
    });
  }

  async function sendVideo(blob: Blob, mime: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const prep = await prepareVideoUpload(slug, { conversationId, mime, size: blob.size });
    if (!prep.ok) return prep;
    const { error } = await createClient().storage.from("whatsapp-media").uploadToSignedUrl(prep.path, prep.token, blob, { contentType: "video/mp4" });
    if (error) return { ok: false, error: "Não foi possível subir o vídeo. Confira a internet e tente de novo." };
    return sendUploadedVideo(slug, { conversationId, path: prep.path, caption });
  }

  return (
    <>
      <Button aria-label="Enviar foto, vídeo, catálogo, material ou produto" title="Enviar foto, vídeo, catálogo, material ou produto (ou cole com Ctrl+V)" onClick={() => setOpen(true)}>
        Anexar
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Enviar para o cliente">
        <nav className="tabs mb-3" aria-label="O que enviar">
          <button type="button" aria-current={tab === "midia" ? "page" : undefined} onClick={() => setTab("midia")}>
            Foto, vídeo ou áudio
          </button>
          <button type="button" aria-current={tab === "materiais" ? "page" : undefined} onClick={() => setTab("materiais")}>
            Catálogos e materiais
          </button>
          <button type="button" aria-current={tab === "produto" ? "page" : undefined} onClick={() => setTab("produto")}>
            Produto do catálogo
          </button>
        </nav>

        {tab === "midia" ? (
          <div className="grid gap-3">
            <label className="btn w-fit cursor-pointer">
              {media ? "Trocar arquivo" : "Escolher foto, vídeo ou áudio"}
              <input
                type="file"
                accept="image/*,video/mp4,video/3gpp,video/quicktime,audio/*"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) void loadFile(f);
                }}
              />
            </label>
            <span className="only-mobile flex flex-wrap gap-2">
              <label className="btn cursor-pointer">
                Tirar foto
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="sr-only"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f) void loadFile(f);
                  }}
                />
              </label>
              <label className="btn cursor-pointer">
                Gravar vídeo
                <input
                  type="file"
                  accept="video/*"
                  capture="environment"
                  className="sr-only"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f) void loadFile(f);
                  }}
                />
              </label>
            </span>
            {!media && <small className="text-xs text-muted">Dica: na caixa de mensagem, Ctrl+V cola a foto ou o vídeo copiado.</small>}
            {media && (
              <>
                {media.kind === "image" ? (
                  // eslint-disable-next-line @next/next/no-img-element -- prévia local (blob)
                  <img src={media.url} alt="Prévia da foto" className="max-h-[40vh] w-auto rounded-xl border border-line object-contain" />
                ) : media.kind === "video" ? (
                  <video src={media.url} controls className="max-h-[40vh] w-auto rounded-xl border border-line" />
                ) : (
                  <audio src={media.url} controls className="w-full" />
                )}
                {media.kind !== "audio" && <input className="inp" value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={1000} placeholder="Legenda (opcional)" aria-label="Legenda" />}
                <div>
                  <Button
                    variant="primary"
                    loading={sending}
                    onClick={() =>
                      media.kind === "audio"
                        ? send(() => sendVoice(slug, conversationId, media.blob), "Áudio")
                        : media.kind === "video"
                        ? send(() => sendVideo(media.blob, media.mime), "Vídeo")
                        : send(() => {
                            const fd = new FormData();
                            fd.set("conversationId", conversationId);
                            fd.set("caption", caption);
                            fd.set("file", new File([media.blob], "foto.jpg", { type: "image/jpeg" }));
                            return sendPhoto(slug, fd);
                          }, "Foto")
                    }
                  >
                    {media.kind === "audio" ? "Enviar áudio" : media.kind === "video" ? "Enviar vídeo" : "Enviar foto"}
                  </Button>
                </div>
              </>
            )}
          </div>
        ) : tab === "materiais" ? (
          materials.length === 0 ? (
            <p className="m-0 text-[13px] text-muted">Nenhum material cadastrado. O gestor inclui os PDFs em Configurações → Automações → Materiais.</p>
          ) : (
            <ul className="m-0 grid max-h-[50vh] list-none gap-2 overflow-auto p-0">
              {materials.map((m) => (
                <li key={m.id} className="flex items-center gap-3 rounded-xl border border-line px-3 py-2">
                  <span className="min-w-0 flex-1">
                    <b className="block truncate font-semibold text-title">{m.title}</b>
                    <small className="text-xs text-muted">
                      {m.kind === "pdf" ? "PDF" : m.kind === "audio" ? "Áudio" : "Imagem"} · {m.fileName}
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

/** Emojis mais usados no atendimento (o cliente recebe como texto normal). */
const EMOJIS = [
  "😊", "😀", "😃", "😉", "🙂", "😍", "🥰", "😘",
  "🤗", "😅", "😂", "🤩", "🙏", "👍", "👏", "👋",
  "🤝", "💪", "👌", "✌️", "👆🏼", "👇🏼", "👉🏼", "✅",
  "✔️", "❌", "⚠️", "❗", "❓", "⭐", "✨", "🔥",
  "💙", "💚", "❤️", "🎉", "🎁", "📦", "🚚", "🏠",
  "📍", "📞", "📲", "💬", "📝", "📄", "📸", "💳",
  "💰", "🕐", "📅", "⏰", "▶️", "◼️", "▪️", "🔹",
];

/** Botão de emojis da caixa de mensagem: o emoji entra onde está o cursor. */
export function EmojiButton({ onPick, disabled }: { onPick: (emoji: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent | globalThis.KeyboardEvent) => {
      if ("key" in e ? e.key === "Escape" : !wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  return (
    <span className="emoji-wrap" ref={wrapRef}>
      <Button aria-label="Emojis" title="Emojis" aria-expanded={open} disabled={disabled} onClick={() => setOpen((o) => !o)}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <circle cx="12" cy="12" r="9" />
          <path d="M8.5 14.5a4.5 4.5 0 0 0 7 0" />
          <path d="M9 9.5h.01M15 9.5h.01" />
        </svg>
      </Button>
      {open && (
        <span className="emoji-pop" role="listbox" aria-label="Escolha um emoji">
          {EMOJIS.map((e) => (
            <button key={e} type="button" role="option" aria-selected={false} onClick={() => onPick(e)}>
              {e}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}
