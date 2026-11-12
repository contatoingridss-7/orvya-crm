"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { coordText, isShortMapsLink, mapsUrl, parseCoordinates, placeLabel, type Coordinates } from "@/lib/location";
import { deletePlace, requestLocation, resolveMapsLink, savePlace, sendLocation, type SavedPlace } from "./actions";

export type { SavedPlace };

const PIN = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" />
    <circle cx="12" cy="10" r="2.4" />
  </svg>
);

/** Cartão da mensagem de localização (recebida ou enviada): abre o ponto no mapa. */
export function LocationCard({ place }: { place: Coordinates & { label: string } }) {
  return (
    <a className="loc-card" href={mapsUrl(place)} target="_blank" rel="noreferrer" aria-label={`Abrir no mapa: ${place.label || coordText(place)}`}>
      <span className="loc-pin">{PIN}</span>
      <span className="min-w-0">
        <b>{place.label || "Localização"}</b>
        <span>{coordText(place)} · Abrir no mapa</span>
      </span>
    </a>
  );
}

const GEO_ERRORS: Record<number, string> = {
  1: "O navegador não tem permissão para ver a localização. Libere a localização para o Orvya nas configurações do navegador e tente de novo.",
  2: "Não foi possível obter a localização agora. Confira o GPS ou a internet.",
  3: "A localização demorou demais. Tente de novo em um lugar com sinal melhor.",
};

const DEFAULT_REQUEST = "Para combinar a entrega, pode me enviar a sua localização? É só tocar no botão abaixo.";

/**
 * Localização na conversa: locais salvos da empresa, a localização atual de quem atende,
 * um link do Google Maps ou coordenadas e o pedido da localização do cliente (só WhatsApp).
 */
export function LocationPanel({
  slug,
  conversationId,
  channel,
  manager,
  places: initialPlaces,
  onSent,
}: {
  slug: string;
  conversationId: string;
  channel: "whatsapp" | "instagram" | "messenger";
  manager: boolean;
  places: SavedPlace[];
  onSent: () => void;
}) {
  const toast = useToast();
  const [places, setPlaces] = useState(initialPlaces);
  const [point, setPoint] = useState<Coordinates | null>(null);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [link, setLink] = useState("");
  const [request, setRequest] = useState(DEFAULT_REQUEST);
  const [locating, setLocating] = useState(false);
  const [busy, start] = useTransition();
  const whatsapp = channel === "whatsapp";

  function locateMe() {
    if (!("geolocation" in navigator)) return toast("Este navegador não informa a localização.", "bad");
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        setPoint({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
      },
      (err) => {
        setLocating(false);
        toast(GEO_ERRORS[err.code] ?? GEO_ERRORS[2]!, "bad");
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  }

  function locate() {
    const value = link.trim();
    if (!value) return;
    const local = parseCoordinates(value);
    if (local) return setPoint(local);
    if (!/^https?:\/\//i.test(value)) return toast("Cole um link do Google Maps ou as coordenadas (ex.: -5.0892, -42.8016).", "bad");
    start(async () => {
      const r = await resolveMapsLink(slug, value);
      if (r.ok) setPoint({ latitude: r.latitude, longitude: r.longitude });
      else toast(r.error, "bad");
    });
  }

  function send(place: Coordinates & { name?: string | null; address?: string | null }) {
    start(async () => {
      const r = await sendLocation(slug, { conversationId, latitude: place.latitude, longitude: place.longitude, name: place.name ?? undefined, address: place.address ?? undefined });
      if (!r.ok) return toast(r.error, "bad");
      toast("Localização enviada.", "ok");
      onSent();
    });
  }

  function save() {
    if (!point) return;
    start(async () => {
      const r = await savePlace(slug, { ...point, name, address });
      if (!r.ok) return toast(r.error, "bad");
      if (r.place) setPlaces((list) => [...list, r.place!].sort((a, b) => a.name.localeCompare(b.name)));
      toast("Local salvo para a equipe.", "ok");
    });
  }

  function remove(p: SavedPlace) {
    if (!window.confirm(`Excluir o local "${p.name}" para toda a equipe?`)) return;
    start(async () => {
      const r = await deletePlace(slug, p.id);
      if (!r.ok) return toast(r.error, "bad");
      setPlaces((list) => list.filter((x) => x.id !== p.id));
    });
  }

  return (
    <div className="grid gap-4">
      <section className="grid gap-2">
        <b className="text-[13px] font-semibold text-title">Locais da empresa</b>
        {places.length === 0 ? (
          <p className="m-0 text-[13px] text-muted">
            {manager
              ? "Nenhum local salvo ainda. Marque o ponto abaixo (por exemplo, a loja), dê um nome e toque em “Salvar para a equipe”."
              : "Nenhum local salvo ainda. A gestão cadastra a loja aqui para todos enviarem com um toque."}
          </p>
        ) : (
          <ul className="m-0 grid max-h-[30vh] list-none gap-2 overflow-auto p-0">
            {places.map((p) => (
              <li key={p.id} className="flex items-center gap-3 rounded-xl border border-line px-3 py-2">
                <span className="min-w-0 flex-1">
                  <b className="block truncate font-semibold text-title">{p.name}</b>
                  <small className="block truncate text-xs text-muted">{p.address || coordText(p)}</small>
                </span>
                {manager && (
                  <Button size="sm" disabled={busy} onClick={() => remove(p)}>
                    Excluir
                  </Button>
                )}
                <Button size="sm" variant="primary" disabled={busy} onClick={() => send(p)}>
                  Enviar
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="grid gap-2">
        <b className="text-[13px] font-semibold text-title">Outro local</b>
        <div className="flex flex-wrap gap-2">
          <Button loading={locating} disabled={busy} onClick={locateMe}>
            Usar minha localização atual
          </Button>
        </div>
        <div className="flex gap-2">
          <input
            className="inp min-w-0 flex-1"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                locate();
              }
            }}
            placeholder="Link do Google Maps ou coordenadas"
            aria-label="Link do Google Maps ou coordenadas"
            inputMode="url"
          />
          <Button disabled={!link.trim() || busy} loading={busy && isShortMapsLink(link)} onClick={locate}>
            Localizar
          </Button>
        </div>
        {point ? (
          <div className="grid gap-2 rounded-xl border border-line p-3">
            <span className="text-[13px]">
              Ponto marcado: <b>{coordText(point)}</b>{" "}
              <a className="underline" href={mapsUrl(point)} target="_blank" rel="noreferrer">
                Conferir no mapa
              </a>
            </span>
            <input className="inp" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Nome do local (opcional)" aria-label="Nome do local" />
            <input className="inp" value={address} onChange={(e) => setAddress(e.target.value)} maxLength={200} placeholder="Endereço (opcional)" aria-label="Endereço" />
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" loading={busy} onClick={() => send({ ...point, name, address })}>
                Enviar localização
              </Button>
              {manager && (
                <Button disabled={busy || !name.trim()} title={name.trim() ? undefined : "Dê um nome ao local para salvar"} onClick={save}>
                  Salvar para a equipe
                </Button>
              )}
              <Button disabled={busy} onClick={() => setPoint(null)}>
                Limpar
              </Button>
            </div>
            {placeLabel({ name, address }) === "" && <small className="text-xs text-muted">Sem nome, o cliente recebe só o ponto no mapa.</small>}
          </div>
        ) : (
          <small className="text-xs text-muted">No Google Maps: abra o local, toque em Compartilhar e copie o link. A localização atual usa o GPS deste aparelho.</small>
        )}
      </section>

      {whatsapp && (
        <section className="grid gap-2">
          <b className="text-[13px] font-semibold text-title">Pedir a localização do cliente</b>
          <textarea className="inp" rows={2} value={request} onChange={(e) => setRequest(e.target.value)} maxLength={1024} aria-label="Texto do pedido" />
          <div>
            <Button
              disabled={busy || !request.trim()}
              onClick={() =>
                start(async () => {
                  const r = await requestLocation(slug, { conversationId, text: request });
                  if (!r.ok) return toast(r.error, "bad");
                  toast("Pedido de localização enviado.", "ok");
                  onSent();
                })
              }
            >
              Pedir localização
            </Button>
          </div>
          <small className="text-xs text-muted">O cliente recebe o texto com o botão “Enviar localização”. A resposta chega na conversa como cartão com mapa.</small>
        </section>
      )}

      {!whatsapp && <p className="m-0 text-[12px] text-muted">No Instagram e no Messenger a localização vai como texto com o link do mapa.</p>}
    </div>
  );
}

/** Botão de localização para as conversas do Instagram e do Messenger (no WhatsApp fica dentro do Anexar). */
export function LocationButton(props: Omit<Parameters<typeof LocationPanel>[0], "onSent"> & { onSent: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button aria-label="Enviar localização" title="Enviar localização" onClick={() => setOpen(true)}>
        {PIN}
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Enviar localização">
        <LocationPanel
          {...props}
          onSent={() => {
            setOpen(false);
            props.onSent();
          }}
        />
      </Modal>
    </>
  );
}
