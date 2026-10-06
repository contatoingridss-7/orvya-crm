import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { graph } from "./graph";

const BUCKET = "whatsapp-media";

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/amr": "amr",
  "video/mp4": "mp4",
  "video/3gpp": "3gp",
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "text/plain": "txt",
};

function extensionFor(mime: string): string {
  const base = mime.split(";")[0]!.trim().toLowerCase();
  return EXT[base] ?? base.split("/")[1]?.replace(/[^a-z0-9]/g, "") ?? "bin";
}

/**
 * Baixa a mídia da Meta e guarda no bucket privado em {empresa}/{conversa}/{mensagem}.{ext}
 * (CLAUDE.md, regra 5). O link da Meta expira: tem que ser na hora.
 */
export async function storeInboundMedia(
  admin: SupabaseClient,
  opts: { mediaId: string; token: string; companyId: string; conversationId: string; messageId: string },
): Promise<void> {
  const meta = await graph<{ url: string; mime_type: string }>(opts.mediaId, opts.token);
  const res = await fetch(meta.url, { headers: { Authorization: `Bearer ${opts.token}` }, cache: "no-store" });
  if (!res.ok) throw new Error(`Falha ao baixar mídia (${res.status})`);
  const body = await res.arrayBuffer();

  const path = `${opts.companyId}/${opts.conversationId}/${opts.messageId}.${extensionFor(meta.mime_type)}`;
  const { error } = await admin.storage.from(BUCKET).upload(path, body, { contentType: meta.mime_type, upsert: true });
  if (error) throw new Error(`Falha ao guardar mídia: ${error.message}`);

  await admin.from("messages").update({ media_path: path, media_mime: meta.mime_type }).eq("id", opts.messageId);
}
