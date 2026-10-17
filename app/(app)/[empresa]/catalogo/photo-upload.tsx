"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { useToast } from "@/components/ui/toast";
import { PHOTO_BUCKET, photoUrl } from "@/lib/catalog/photos";
import { createClient } from "@/lib/supabase/client";

/** Lado maior da foto salva. Foto de celular (4 MB+) vira ~200 KB, rápida no 4G. */
const MAX_SIDE = 1200;

/** Reduz e converte para JPEG no próprio aparelho antes de enviar. */
async function shrink(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  ctx.fillStyle = "#fff"; // PNG com fundo transparente fica branco
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("blob"))), "image/jpeg", 0.85));
}

type Props = { companyId: string; productId: string; productName: string; path: string | null };

/**
 * Foto do produto: gestor, admin e expedição enviam pelo celular (câmera ou galeria).
 * O envio vai direto para o Storage com a sessão do usuário; o RLS confere o perfil.
 */
export function PhotoUpload({ companyId, productId, productName, path }: Props) {
  const router = useRouter();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [current, setCurrent] = useState(path);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(file.type) && !/\.(jpe?g|png|webp|heic)$/i.test(file.name)) {
      setError("Envie uma foto em JPG, PNG ou WEBP.");
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const blob = await shrink(file);
      const supabase = createClient();
      const newPath = `${companyId}/${productId}-${Date.now()}.jpg`;
      const up = await supabase.storage.from(PHOTO_BUCKET).upload(newPath, blob, { contentType: "image/jpeg", cacheControl: "31536000" });
      if (up.error) throw new Error("upload");
      const { error: rpcError } = await supabase.rpc("set_product_photo", { p_product: productId, p_path: newPath });
      if (rpcError) {
        await supabase.storage.from(PHOTO_BUCKET).remove([newPath]);
        throw new Error("rpc");
      }
      if (current) await supabase.storage.from(PHOTO_BUCKET).remove([current]);
      setCurrent(newPath);
      toast("Foto salva.", "ok");
      router.refresh();
    } catch {
      setError("Não foi possível enviar a foto. Confira a conexão e tente de novo.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  async function remove() {
    if (!current) return;
    setBusy(true);
    setError(undefined);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("set_product_photo", { p_product: productId, p_path: null });
    if (rpcError) setError("Não foi possível remover a foto.");
    else {
      await supabase.storage.from(PHOTO_BUCKET).remove([current]);
      setCurrent(null);
      toast("Foto removida.", "ok");
      router.refresh();
    }
    setBusy(false);
  }

  const url = photoUrl(current);

  return (
    <section className="grid gap-2.5">
      <h3 className="text-[13px] font-[650]">Foto</h3>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={`Foto de ${productName}`} className="thumb lg" />
      ) : (
        <p className="m-0 text-[13px] text-muted">Sem foto. A foto ajuda a expedição a separar o item certo.</p>
      )}
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => onFile(e.target.files?.[0])}
        aria-label={`Escolher foto de ${productName}`}
      />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="soft" loading={busy} onClick={() => input.current?.click()}>
          {url ? "Trocar foto" : "Adicionar foto"}
        </Button>
        {url && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={remove}>
            Remover
          </Button>
        )}
      </div>
      {error && <Notice tone="bad">{error}</Notice>}
    </section>
  );
}
