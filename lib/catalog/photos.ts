import { publicEnv } from "@/lib/env";

export const PHOTO_BUCKET = "product-photos";

/** URL pública da foto do produto (bucket público: a foto pode ir para o cliente no WhatsApp). */
export function photoUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  return `${publicEnv.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${PHOTO_BUCKET}/${path.split("/").map(encodeURIComponent).join("/")}`;
}
