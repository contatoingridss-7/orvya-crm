/** Janela de atendimento: 24 h depois da última mensagem do cliente (docs/WHATSAPP.md, seção 4). */
export const WINDOW_MS = 24 * 60 * 60 * 1000;

export function windowEndsAt(lastInboundAt: string | null): Date | null {
  return lastInboundAt ? new Date(new Date(lastInboundAt).getTime() + WINDOW_MS) : null;
}

export function isWindowOpen(lastInboundAt: string | null, now = Date.now()): boolean {
  const end = windowEndsAt(lastInboundAt);
  return !!end && end.getTime() > now;
}
