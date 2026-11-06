"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { TextAreaField, TextField } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { Panel } from "@/components/ui/panel";
import { useToast } from "@/components/ui/toast";
import { createClient } from "@/lib/supabase/client";
import { convertToVoice } from "../composer-extras";
import { addMaterial, deleteMaterial, deleteQuickReply, saveQuickReply, type ActionResult } from "./actions";

export type ReplyRow = { id: string; shortcut: string; body: string; uses: number; materialIds: string[] };
export type MaterialRow = { id: string; title: string; fileName: string; mime: string; size: number; uses: number };

const MAX_BYTES = 16 * 1024 * 1024;
const TYPES: Record<string, string> = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png" };
const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

function useRun() {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<ActionResult>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      toast(r.ok ? r.message : r.error, r.ok ? "ok" : "bad");
      if (r.ok) {
        after?.();
        router.refresh();
      }
    });
  return { pending, run };
}

/** Respostas rápidas: a equipe digita "/" na conversa e escolhe; as mais usadas aparecem primeiro. */
export function QuickRepliesManager({
  slug,
  replies,
  materials,
  loadError,
}: {
  slug: string;
  replies: ReplyRow[];
  /** Imagens que podem ir junto com a resposta. */
  materials: { id: string; title: string }[];
  loadError: boolean;
}) {
  const { pending, run } = useRun();
  const [editing, setEditing] = useState<ReplyRow | null>(null);
  const [shortcut, setShortcut] = useState("");
  const [body, setBody] = useState("");
  const [attach, setAttach] = useState<string[]>([]);
  const titleOf = (id: string) => materials.find((m) => m.id === id)?.title;

  function edit(r: ReplyRow | null) {
    setEditing(r);
    setShortcut(r?.shortcut ?? "");
    setBody(r?.body ?? "");
    setAttach(r?.materialIds ?? []);
  }

  return (
    <Panel title="Respostas rápidas" subtitle="Na conversa, digite / e o começo do atalho (ex.: /hor) para usar. {nome} vira o primeiro nome do cliente e {vendedor}, o de quem envia.">
      {loadError && <Notice tone="bad">Não foi possível carregar. Rode a migration 0021 no Supabase.</Notice>}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <ul className="m-0 grid list-none content-start gap-2 p-0">
          {replies.length === 0 && <li className="empty">Nenhuma resposta ainda.</li>}
          {replies.map((r) => (
            <li key={r.id} className="flex items-start gap-3 rounded-xl border border-line px-3 py-2.5">
              <span className="min-w-0 flex-1">
                <b className="font-semibold text-accent">/{r.shortcut}</b>
                <span className="block text-[13px] whitespace-pre-line">{r.body}</span>
                {r.materialIds.length > 0 && (
                  <small className="block text-xs text-accent">
                    Vai com {r.materialIds.length === 1 ? "a imagem" : `${r.materialIds.length} imagens`}: {r.materialIds.map(titleOf).filter(Boolean).join(" · ")}
                  </small>
                )}
                <small className="text-xs text-muted">{r.uses === 1 ? "usada 1 vez" : `usada ${r.uses} vezes`}</small>
              </span>
              <Button size="sm" variant="ghost" onClick={() => edit(r)}>
                Editar
              </Button>
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => deleteQuickReply(slug, r.id), () => editing?.id === r.id && edit(null))}>
                Excluir
              </Button>
            </li>
          ))}
        </ul>
        <div className="grid content-start gap-3">
          <b className="text-[14px] font-[650]">{editing ? `Editar /${editing.shortcut}` : "Nova resposta"}</b>
          <TextField label="Atalho" value={shortcut} onChange={(e) => setShortcut(e.target.value)} placeholder="Ex.: horario" maxLength={31} hint="Sem espaço; vira /atalho na conversa." />
          <TextAreaField label="Texto" value={body} onChange={(e) => setBody(e.target.value)} rows={5} maxLength={2000} placeholder="Ex.: Oi, {nome}! Nosso atendimento é de segunda a sexta, das 8h às 18h." />
          {materials.length > 0 && (
            <fieldset className="m-0 grid max-h-[220px] gap-1.5 overflow-auto rounded-xl border border-line p-3 text-[13px]">
              <legend className="px-1 text-xs text-muted">Imagens que vão junto (opcional)</legend>
              {materials.map((m) => (
                <label key={m.id} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={attach.includes(m.id)}
                    onChange={(e) => setAttach((a) => (e.target.checked ? [...a, m.id] : a.filter((x) => x !== m.id)))}
                  />
                  {m.title}
                </label>
              ))}
              <small className="text-xs text-muted">Uma imagem: vai com o texto como legenda. Várias: vai o texto e depois as imagens.</small>
            </fieldset>
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" loading={pending} onClick={() => run(() => saveQuickReply(slug, { id: editing?.id, shortcut, body, materialIds: attach }), () => edit(null))}>
              {editing ? "Salvar alteração" : "Incluir resposta"}
            </Button>
            {editing && (
              <Button variant="ghost" onClick={() => edit(null)}>
                Cancelar
              </Button>
            )}
          </div>
        </div>
      </div>
    </Panel>
  );
}

/** Catálogos e materiais (PDF ou imagem): o vendedor envia na conversa pelo botão Anexar. */
export function MaterialsManager({ slug, companyId, materials, loadError }: { slug: string; companyId: string; materials: MaterialRow[]; loadError: boolean }) {
  const { pending, run } = useRun();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  async function upload() {
    if (!file) return toast("Escolha o arquivo.", "bad");
    const isAudio = file.type.startsWith("audio/");
    const ext = isAudio ? "ogg" : TYPES[file.type];
    if (!ext) return toast("Envie PDF, JPG, PNG ou áudio.", "bad");
    if (file.size > (isAudio ? 4 * 1024 * 1024 : MAX_BYTES)) return toast(isAudio ? "Áudio acima de 4 MB." : "Arquivo acima de 16 MB. Reduza o PDF e tente de novo.", "bad");
    const name = title.trim() || file.name.replace(/\.[^.]+$/, "");
    setUploading(true);
    // Áudio vira mensagem de voz do WhatsApp (OGG/Opus) antes de subir.
    let body: Blob = file;
    if (isAudio) {
      try {
        body = await convertToVoice(file);
      } catch (e) {
        setUploading(false);
        return toast(e instanceof Error ? e.message : "Não foi possível converter o áudio.", "bad");
      }
    }
    const mime = isAudio ? "audio/ogg" : file.type;
    const path = `${companyId}/${crypto.randomUUID()}.${ext}`;
    const up = await createClient().storage.from("sales-materials").upload(path, body, { contentType: mime });
    setUploading(false);
    if (up.error) return toast(isAudio ? "Não foi possível enviar o áudio. A migration 0029 já foi rodada?" : "Não foi possível enviar o arquivo. A migration 0021 já foi rodada?", "bad");
    run(
      () => addMaterial(slug, { title: name, filePath: path, fileName: file.name.slice(0, 120), mime: mime as "application/pdf", size: body.size }),
      () => {
        setTitle("");
        setFile(null);
        if (fileRef.current) fileRef.current.value = "";
      },
    );
  }

  return (
    <Panel title="Catálogos e materiais" subtitle="PDFs, imagens e áudios que a equipe envia ao cliente pelo botão Anexar da conversa. Até 16 MB cada.">
      {loadError && <Notice tone="bad">Não foi possível carregar. Rode a migration 0021 no Supabase.</Notice>}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <ul className="m-0 grid list-none content-start gap-2 p-0">
          {materials.length === 0 && <li className="empty">Nenhum material ainda.</li>}
          {materials.map((m) => (
            <li key={m.id} className="flex items-center gap-3 rounded-xl border border-line px-3 py-2.5">
              <span className="min-w-0 flex-1">
                <b className="block truncate font-semibold text-title">{m.title}</b>
                <small className="text-xs text-muted">
                  {m.mime === "application/pdf" ? "PDF" : m.mime.startsWith("audio/") ? "Áudio" : "Imagem"} · {kb(m.size)} · enviado {m.uses === 1 ? "1 vez" : `${m.uses} vezes`}
                </small>
              </span>
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => deleteMaterial(slug, m.id))}>
                Excluir
              </Button>
            </li>
          ))}
        </ul>
        <div className="grid content-start gap-3">
          <b className="text-[14px] font-[650]">Incluir material</b>
          <TextField label="Nome" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: Catálogo de ortopédicos 2026" maxLength={120} />
          <label className="field">
            <span>Arquivo (PDF, JPG ou PNG)</span>
            <input ref={fileRef} type="file" accept="application/pdf,image/jpeg,image/png,audio/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
          <div>
            <Button variant="primary" loading={uploading || pending} onClick={upload}>
              Enviar arquivo
            </Button>
          </div>
        </div>
      </div>
    </Panel>
  );
}
