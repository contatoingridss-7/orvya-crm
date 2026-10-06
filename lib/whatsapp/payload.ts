// Formato (parcial) dos eventos do webhook da WhatsApp Cloud API.
// Tudo opcional: a Meta pode mandar campos novos ou omitir os conhecidos.

export type WaMedia = { id?: string; mime_type?: string; caption?: string; filename?: string };

export type WaMessage = {
  from?: string;
  to?: string;
  id?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  image?: WaMedia;
  audio?: WaMedia;
  video?: WaMedia;
  document?: WaMedia;
  sticker?: WaMedia;
  location?: { latitude?: number; longitude?: number; name?: string; address?: string };
  contacts?: { name?: { formatted_name?: string } }[];
  interactive?: { type?: string; button_reply?: { title?: string }; list_reply?: { title?: string } };
  button?: { text?: string };
  reaction?: { emoji?: string; message_id?: string };
  context?: { id?: string };
  referral?: Record<string, unknown>;
};

export type WaStatus = {
  id?: string;
  status?: "sent" | "delivered" | "read" | "failed" | string;
  timestamp?: string;
  recipient_id?: string;
  errors?: unknown[];
  pricing?: Record<string, unknown>;
};

export type WaHistoryThread = { id?: string; messages?: WaMessage[] };

export type WaChangeValue = {
  messaging_product?: string;
  metadata?: { display_phone_number?: string; phone_number_id?: string };
  contacts?: { wa_id?: string; profile?: { name?: string } }[];
  messages?: WaMessage[];
  statuses?: WaStatus[];
  // Coexistência (app WhatsApp Business + API)
  message_echoes?: WaMessage[];
  history?: { metadata?: Record<string, unknown>; threads?: WaHistoryThread[] }[];
};

export type WaWebhookPayload = {
  object?: string;
  entry?: { id?: string; changes?: { field?: string; value?: WaChangeValue }[] }[];
};

const MEDIA_TYPES = ["image", "audio", "video", "document", "sticker"] as const;

/** Texto que aparece na conversa para cada tipo de mensagem. */
export function describeMessage(m: WaMessage): { body: string; mediaId: string | null } {
  const media = MEDIA_TYPES.find((t) => m.type === t);
  if (media) {
    const obj = m[media];
    const label = { image: "Imagem", audio: "Áudio", video: "Vídeo", document: "Documento", sticker: "Figurinha" }[media];
    const text = obj?.caption || (media === "document" ? obj?.filename : undefined);
    return { body: text ? `[${label}] ${text}` : `[${label}]`, mediaId: obj?.id ?? null };
  }
  switch (m.type) {
    case "text":
      return { body: m.text?.body ?? "", mediaId: null };
    case "location": {
      const l = m.location;
      const place = [l?.name, l?.address].filter(Boolean).join(" — ");
      return { body: `[Localização] ${place || `${l?.latitude}, ${l?.longitude}`}`, mediaId: null };
    }
    case "contacts":
      return { body: `[Contato] ${m.contacts?.map((c) => c.name?.formatted_name).filter(Boolean).join(", ") ?? ""}`, mediaId: null };
    case "interactive":
      return { body: m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? "[Resposta interativa]", mediaId: null };
    case "button":
      return { body: m.button?.text ?? "[Botão]", mediaId: null };
    case "reaction":
      return { body: m.reaction?.emoji ? `Reagiu com ${m.reaction.emoji}` : "Removeu a reação", mediaId: null };
    default:
      return { body: "[Mensagem que o WhatsApp não permite exibir aqui]", mediaId: null };
  }
}

export type TrackingCode = { code: string; source: "Google Ads" | "Site" };

/**
 * Código de campanha no fim da mensagem pronta do link do WhatsApp (docs/INTEGRACOES.md):
 * [G1], [G2]... = anúncio do Google; [S1]... = botão do site. O código sai do texto que a equipe vê.
 */
export function extractTrackingCode(body: string): { clean: string; tracking: TrackingCode | null } {
  const match = body.match(/\[\s*([GS])\s*-?\s*(\d{1,4})\s*\]/i);
  if (!match) return { clean: body, tracking: null };
  const letter = match[1]!.toUpperCase();
  const clean = body.replace(match[0], "").replace(/\s{2,}/g, " ").trim();
  return {
    clean: clean || body,
    tracking: { code: `${letter}${match[2]}`, source: letter === "G" ? "Google Ads" : "Site" },
  };
}

/** Timestamp da Meta (segundos, em texto) → ISO. */
export function waTime(ts: string | undefined): string {
  const n = Number(ts);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : new Date().toISOString();
}

/**
 * Variações do mesmo telefone brasileiro, com e sem o nono dígito
 * (o WhatsApp às vezes entrega o wa_id sem o 9). Ex.: 5586999990000 ↔ 558699990000.
 */
export function phoneCandidates(waId: string): string[] {
  const d = waId.replace(/\D/g, "");
  const out = new Set([`+${d}`]);
  if (d.startsWith("55") && d.length === 13 && d[4] === "9") out.add(`+${d.slice(0, 4)}${d.slice(5)}`);
  if (d.startsWith("55") && d.length === 12 && /[6-9]/.test(d[4] ?? "")) out.add(`+${d.slice(0, 4)}9${d.slice(4)}`);
  return [...out];
}
