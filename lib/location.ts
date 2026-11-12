// Localização nas conversas: formato do texto guardado em messages.body e leitura de coordenadas.
// Sem dependências de servidor: vale para a tela, as ações e o webhook.

export type Coordinates = { latitude: number; longitude: number };
export type Place = Coordinates & { name?: string | null; address?: string | null };

const NUM = "-?\\d{1,3}(?:\\.\\d+)?";

function valid(latitude: number, longitude: number): Coordinates | null {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  if (latitude === 0 && longitude === 0) return null;
  return { latitude, longitude };
}

/** Coordenadas com 6 casas (cerca de 10 cm), como a Meta e o Google Maps usam. */
export const coordText = (c: Coordinates) => `${c.latitude.toFixed(6)}, ${c.longitude.toFixed(6)}`;

/** Link que abre o ponto no Google Maps (no celular, abre o aplicativo). */
export const mapsUrl = (c: Coordinates) => `https://www.google.com/maps/search/?api=1&query=${c.latitude.toFixed(6)},${c.longitude.toFixed(6)}`;

/** "Nome — endereço" (o que existir). */
export const placeLabel = (p: { name?: string | null; address?: string | null }) => [p.name?.trim(), p.address?.trim()].filter(Boolean).join(" — ");

/**
 * Texto guardado na mensagem de localização (recebida ou enviada):
 *   [Localização] Nome — endereço
 *   https://www.google.com/maps/search/?api=1&query=-5.089200,-42.801600
 * A tela transforma em cartão; onde o texto aparece cru (resumo, prévia), o link continua útil.
 */
export function locationBody(p: Place): string {
  const label = placeLabel(p);
  return `[Localização]${label ? ` ${label}` : ""}\n${mapsUrl(p)}`;
}

const BODY_RE = new RegExp(`^\\[Localização\\]\\s*([\\s\\S]*?)\\s*https://www\\.google\\.com/maps/search/\\?api=1&query=(${NUM}),(${NUM})\\s*$`);
const LEGACY_RE = new RegExp(`^\\[Localização\\]\\s*(${NUM}),\\s*(${NUM})\\s*$`);

/** Lê o texto de uma mensagem de localização. Devolve null se não for uma (ou se não tiver coordenadas). */
export function parseLocationBody(body: string | null | undefined): (Coordinates & { label: string }) | null {
  if (!body?.startsWith("[Localização]")) return null;
  const m = BODY_RE.exec(body);
  if (m) {
    const c = valid(Number(m[2]), Number(m[3]));
    return c ? { ...c, label: m[1]!.trim() } : null;
  }
  // Mensagens antigas sem nome: "[Localização] -5.08, -42.80".
  const old = LEGACY_RE.exec(body);
  if (old) {
    const c = valid(Number(old[1]), Number(old[2]));
    return c ? { ...c, label: "" } : null;
  }
  return null;
}

/** Hosts do Google Maps aceitos (links completos e curtos). */
export function isGoogleMapsHost(host: string): boolean {
  const h = host.toLowerCase();
  return h === "maps.app.goo.gl" || h === "goo.gl" || h === "g.co" || /^(www\.|maps\.|consent\.)?google\.(com|com\.br)$/.test(h);
}

/** Link curto do Google Maps (não traz as coordenadas: o servidor segue o redirecionamento). */
export function isShortMapsLink(input: string): boolean {
  try {
    const h = new URL(input.trim()).hostname.toLowerCase();
    return h === "maps.app.goo.gl" || h === "goo.gl" || h === "g.co";
  } catch {
    return false;
  }
}

/**
 * Coordenadas a partir do que a pessoa colou: "-5.0892, -42.8016", "-5,0892 -42,8016"
 * ou um link completo do Google Maps (pino do lugar, parâmetro q/query/ll ou centro do mapa).
 */
export function parseCoordinates(input: string): Coordinates | null {
  const text = input.trim();
  if (!text) return null;
  let decoded = text;
  try {
    decoded = decodeURIComponent(text);
  } catch {
    // mantém como veio
  }

  if (/^https?:\/\//i.test(text)) {
    const patterns = [
      new RegExp(`!3d(${NUM})!4d(${NUM})`), // pino do lugar (mais preciso que o centro do mapa)
      new RegExp(`[?&](?:q|query|ll|destination|center)=(?:loc:)?(${NUM}),\\s*(${NUM})`),
      new RegExp(`@(${NUM}),(${NUM})`),
      new RegExp(`/(?:place|search|dir)/(${NUM}),\\+?(${NUM})`),
    ];
    for (const re of patterns) {
      const m = re.exec(decoded);
      if (m) {
        const c = valid(Number(m[1]), Number(m[2]));
        if (c) return c;
      }
    }
    return null;
  }

  // "lat, lng" com ponto decimal.
  const dot = new RegExp(`^(${NUM})\\s*[,; ]\\s*(${NUM})$`).exec(text);
  if (dot) return valid(Number(dot[1]), Number(dot[2]));
  // Decimal com vírgula: "-5,0892 -42,8016" ou "-5,0892; -42,8016".
  const comma = /^(-?\d{1,3},\d+)\s*[; ]\s*(-?\d{1,3},\d+)$/.exec(text);
  if (comma) return valid(Number(comma[1]!.replace(",", ".")), Number(comma[2]!.replace(",", ".")));
  return null;
}
