import "server-only";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ffmpegPath from "ffmpeg-static";

/**
 * Converte qualquer áudio (gravação do navegador em WebM, MP3, M4A...) para OGG/Opus, o formato
 * de mensagem de voz do WhatsApp. Roda no servidor, sem enviar o áudio para outro serviço.
 */
export async function toVoiceNote(input: ArrayBuffer): Promise<Buffer> {
  if (!ffmpegPath) throw new Error("Conversor de áudio indisponível.");
  const dir = await mkdtemp(join(tmpdir(), "orvya-audio-"));
  const src = join(dir, "entrada");
  const out = join(dir, "saida.ogg");
  try {
    await writeFile(src, Buffer.from(input));
    await new Promise<void>((resolve, reject) => {
      const p = spawn(ffmpegPath as string, ["-hide_banner", "-loglevel", "error", "-y", "-i", src, "-vn", "-ac", "1", "-ar", "48000", "-c:a", "libopus", "-b:a", "32k", "-application", "voip", out]);
      let err = "";
      p.stderr.on("data", (d: Buffer) => (err += d.toString()));
      p.on("error", reject);
      p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(err.slice(0, 300) || `conversão falhou (${code})`))));
    });
    return await readFile(out);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
