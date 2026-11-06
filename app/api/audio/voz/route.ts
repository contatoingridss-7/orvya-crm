import { NextResponse, type NextRequest } from "next/server";
import { getViewer } from "@/lib/auth/viewer";
import { toVoiceNote } from "@/lib/media/voice";

// Converte o áudio gravado no navegador (ou um arquivo MP3/M4A) para mensagem de voz do WhatsApp
// (OGG/Opus). Só para quem está logado; o áudio não é guardado aqui.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX = 4 * 1024 * 1024;

export async function POST(request: NextRequest) {
  const viewer = await getViewer();
  if (!viewer?.active) return NextResponse.json({ erro: "Entre no Orvya para enviar áudio." }, { status: 401 });
  const type = request.headers.get("content-type") ?? "";
  if (!/^(audio|video)\//.test(type)) return NextResponse.json({ erro: "Envie um arquivo de áudio." }, { status: 415 });
  const body = await request.arrayBuffer();
  if (body.byteLength === 0) return NextResponse.json({ erro: "Áudio vazio." }, { status: 400 });
  if (body.byteLength > MAX) return NextResponse.json({ erro: "Áudio grande demais (máximo de 4 MB, cerca de 4 minutos)." }, { status: 413 });
  try {
    const ogg = await toVoiceNote(body);
    return new NextResponse(new Uint8Array(ogg), { headers: { "content-type": "audio/ogg", "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ erro: "Não foi possível converter o áudio. Tente gravar de novo." }, { status: 422 });
  }
}
