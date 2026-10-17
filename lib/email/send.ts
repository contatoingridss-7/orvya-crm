import "server-only";

// E-mail transacional pelo Resend (https://resend.com), só no servidor.
// RESEND_API_KEY: chave da conta. EMAIL_FROM: remetente de um domínio verificado no Resend,
// ex.: "Orvya <relatorios@seudominio.com.br>". Sem domínio próprio, o Resend só entrega
// para o e-mail dono da conta (modo de teste, remetente onboarding@resend.dev).

export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

export type SendResult = { ok: true } | { ok: false; error: string };

export async function sendEmail(input: { to: string[]; subject: string; html: string; text: string }): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!key || !from) return { ok: false, error: "E-mail não configurado (RESEND_API_KEY e EMAIL_FROM)." };
  if (!input.to.length) return { ok: false, error: "Sem destinatários." };

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: input.to, subject: input.subject, html: input.html, text: input.text }),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);

  if (!res) return { ok: false, error: "Sem conexão com o serviço de e-mail." };
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    return { ok: false, error: body?.message ?? `Serviço de e-mail respondeu ${res.status}.` };
  }
  return { ok: true };
}
