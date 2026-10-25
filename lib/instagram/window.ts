/** Regras de prazo do Direct (Meta): resposta livre até 24 h; resposta de pessoa da equipe até 7 dias. */
export const IG_WINDOW_MS = 24 * 3600_000;
export const IG_HUMAN_WINDOW_MS = 7 * 24 * 3600_000;

export type IgWindow = "open" | "human" | "closed";

export function instagramWindow(lastInboundAt: string | null, now = Date.now()): IgWindow {
  if (!lastInboundAt) return "closed";
  const age = now - new Date(lastInboundAt).getTime();
  if (age <= IG_WINDOW_MS) return "open";
  if (age <= IG_HUMAN_WINDOW_MS) return "human";
  return "closed";
}

/** Quando o prazo de resposta da equipe acaba (7 dias depois da última mensagem do cliente). */
export function instagramWindowEndsAt(lastInboundAt: string): Date {
  return new Date(new Date(lastInboundAt).getTime() + IG_HUMAN_WINDOW_MS);
}
