"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { saveAvatar } from "@/lib/auth/actions";
import { initials } from "@/lib/names";
import { createClient } from "@/lib/supabase/client";

/** Recorta o centro da foto em quadrado de 400 px (JPG). */
async function squarePhoto(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 400;
  canvas.getContext("2d")!.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 400, 400);
  bitmap.close();
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("foto"))), "image/jpeg", 0.85));
}

function Avatar({ name, url, size }: { name: string; url: string | null; size: "sm" | "lg" }) {
  return (
    <span className={`me-av ${size === "lg" ? "lg" : ""}`}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- foto do perfil no bucket público
        <img src={url} alt="" />
      ) : (
        <span className="me-ini">{initials(name)}</span>
      )}
    </span>
  );
}

/** Foto redonda no topo (com o arco girando) e o "Meu perfil" para trocar a foto. */
export function ProfileMenu({ userId, name, avatarUrl }: { userId: string; name: string; avatarUrl: string | null }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function upload(file: File) {
    setBusy(true);
    try {
      const blob = await squarePhoto(file);
      const path = `${userId}/${crypto.randomUUID()}.jpg`;
      const { error } = await createClient().storage.from("avatars").upload(path, blob, { contentType: "image/jpeg" });
      if (error) throw new Error("Não foi possível enviar a foto. A migration 0031 já foi rodada?");
      const r = await saveAvatar(path);
      if (!r.ok) throw new Error(r.error);
      toast("Foto atualizada.", "ok");
      router.refresh();
    } catch (e) {
      toast(e instanceof Error && e.message !== "foto" ? e.message : "Não foi possível abrir esta imagem. Use JPG ou PNG.", "bad");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="me-btn" onClick={() => setOpen(true)} aria-label="Meu perfil" title="Meu perfil">
        <Avatar name={name} url={avatarUrl} size="sm" />
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Meu perfil">
        <div className="grid justify-items-center gap-3 text-center">
          <Avatar name={name} url={avatarUrl} size="lg" />
          <b className="text-[15px] font-semibold text-title">{name}</b>
          <div className="flex flex-wrap justify-center gap-2">
            <label className={`btn primary cursor-pointer ${busy ? "pointer-events-none opacity-60" : ""}`}>
              {busy ? "Enviando…" : avatarUrl ? "Trocar foto" : "Escolher foto"}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) void upload(f);
                }}
              />
            </label>
            {avatarUrl && (
              <Button
                variant="ghost"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  const r = await saveAvatar(null);
                  setBusy(false);
                  if (r.ok) {
                    toast("Foto removida.", "ok");
                    router.refresh();
                  } else toast(r.error, "bad");
                }}
              >
                Remover foto
              </Button>
            )}
          </div>
          <small className="text-xs text-muted">A foto aparece no topo do Orvya. O nome é alterado pelo administrador, em Equipe.</small>
        </div>
      </Modal>
    </>
  );
}
