import "server-only";

// Versão da Graph API: use a atual da documentação da Meta (META_GRAPH_VERSION).
const DEFAULT_GRAPH_VERSION = "v23.0";

export function graphBase(): string {
  const version = process.env.META_GRAPH_VERSION?.trim() || DEFAULT_GRAPH_VERSION;
  return `https://graph.facebook.com/${version}`;
}

export function appSecret(): string | null {
  return process.env.META_APP_SECRET?.trim() || null;
}

export function verifyToken(): string | null {
  return process.env.META_WEBHOOK_VERIFY_TOKEN?.trim() || null;
}

/** Para a tela Canais mostrar o que falta configurar (sem revelar valores). */
export function whatsappEnvStatus() {
  return {
    appSecret: !!appSecret(),
    verifyToken: !!verifyToken(),
    graphVersion: process.env.META_GRAPH_VERSION?.trim() || `${DEFAULT_GRAPH_VERSION} (padrão)`,
  };
}
