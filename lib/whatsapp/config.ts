import "server-only";

// Versão da Graph API: use a atual da documentação da Meta (META_GRAPH_VERSION).
const DEFAULT_GRAPH_VERSION = "v23.0";

export function graphBase(): string {
  const version = process.env.META_GRAPH_VERSION?.trim() || DEFAULT_GRAPH_VERSION;
  return `https://graph.facebook.com/${version}`;
}

/**
 * App Secret de cada app da Meta (um app por empresa: LocPress, IC Supra).
 * Na Vercel: META_APP_SECRET com os segredos separados por vírgula.
 */
export function appSecrets(): string[] {
  return (process.env.META_APP_SECRET ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function verifyToken(): string | null {
  return process.env.META_WEBHOOK_VERIFY_TOKEN?.trim() || null;
}

/** Para a tela Canais mostrar o que falta configurar (sem revelar valores). */
export function whatsappEnvStatus() {
  return {
    appSecret: appSecrets().length > 0,
    appSecretCount: appSecrets().length,
    verifyToken: !!verifyToken(),
    graphVersion: process.env.META_GRAPH_VERSION?.trim() || `${DEFAULT_GRAPH_VERSION} (padrão)`,
  };
}
