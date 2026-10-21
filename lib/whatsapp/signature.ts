import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Confere o cabeçalho X-Hub-Signature-256 da Meta: "sha256=" + HMAC-SHA256(corpo cru, App Secret).
 * Comparação em tempo constante (CLAUDE.md, regra 3).
 */
export function isValidSignature(rawBody: string, header: string | null, secret: string): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = Buffer.from(`sha256=${createHmac("sha256", secret).update(rawBody, "utf8").digest("hex")}`, "utf8");
  const received = Buffer.from(header, "utf8");
  return expected.length === received.length && timingSafeEqual(expected, received);
}

/** Um app da Meta por empresa: a assinatura vale se bater com o segredo de qualquer um deles. */
export function isValidSignatureAny(rawBody: string, header: string | null, secrets: string[]): boolean {
  return secrets.some((s) => isValidSignature(rawBody, header, s));
}
