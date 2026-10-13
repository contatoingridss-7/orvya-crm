import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Mídia do WhatsApp: confere com o cliente do usuário se ele vê a mensagem (RLS)
 * e só então redireciona para uma URL assinada de 10 minutos (CLAUDE.md, regra 5).
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: message } = await supabase.from("messages").select("media_path").eq("id", id).maybeSingle<{ media_path: string | null }>();
  if (!message?.media_path) return new NextResponse("Arquivo não encontrado", { status: 404 });

  const { data, error } = await createAdminClient().storage.from("whatsapp-media").createSignedUrl(message.media_path, 600);
  if (error || !data) return new NextResponse("Arquivo indisponível", { status: 404 });
  return NextResponse.redirect(data.signedUrl, { headers: { "Cache-Control": "private, no-store" } });
}
