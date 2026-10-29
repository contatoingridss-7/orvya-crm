"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

// Cadastro integrado da Meta (Embedded Signup) pelo SDK oficial do Facebook.
// A janela da Meta devolve um código (vale 30 s) e, por mensagem, a conta e o número escolhidos.

type FbLoginResponse = { authResponse?: { code?: string } | null };
type FbSdk = {
  init(options: { appId: string; autoLogAppEvents: boolean; xfbml: boolean; version: string }): void;
  login(callback: (response: FbLoginResponse) => void, options: Record<string, unknown>): void;
};

declare global {
  interface Window {
    FB?: FbSdk;
    fbAsyncInit?: () => void;
  }
}

const GRAPH_VERSION = "v26.0";
let sdkPromise: Promise<FbSdk> | null = null;

function loadSdk(appId: string): Promise<FbSdk> {
  if (window.FB) return Promise.resolve(window.FB);
  sdkPromise ??= new Promise<FbSdk>((resolve, reject) => {
    const timer = setTimeout(() => {
      sdkPromise = null;
      reject(new Error("timeout"));
    }, 15_000);
    window.fbAsyncInit = () => {
      clearTimeout(timer);
      window.FB!.init({ appId, autoLogAppEvents: true, xfbml: false, version: GRAPH_VERSION });
      resolve(window.FB!);
    };
    const script = document.createElement("script");
    script.id = "facebook-jssdk";
    script.src = "https://connect.facebook.net/pt_BR/sdk.js";
    script.async = true;
    script.defer = true;
    script.crossOrigin = "anonymous";
    script.onerror = () => {
      clearTimeout(timer);
      sdkPromise = null;
      reject(new Error("load"));
    };
    document.body.appendChild(script);
  });
  return sdkPromise;
}

export type SignupResult = { code: string; wabaId: string; phoneNumberId: string; coexistence: boolean };
type Session = { event: string; wabaId?: string; phoneNumberId?: string };

export function MetaSignupButton({
  appId,
  configId,
  disabled,
  onResult,
  onError,
}: {
  appId: string;
  configId: string;
  disabled?: boolean;
  onResult: (r: SignupResult) => void;
  onError: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);

  async function start() {
    setBusy(true);
    let fb: FbSdk;
    try {
      fb = await loadSdk(appId);
    } catch {
      setBusy(false);
      onError("Não foi possível abrir a janela da Meta. Desligue o bloqueador de anúncios e tente de novo.");
      return;
    }

    let session: Session | null = null;
    let canceled = false;
    const onMessage = (ev: MessageEvent) => {
      if (!/(^|\.)facebook\.com$/.test(new URL(ev.origin).hostname)) return;
      try {
        const data = typeof ev.data === "string" ? JSON.parse(ev.data) : ev.data;
        if (data?.type !== "WA_EMBEDDED_SIGNUP") return;
        if (String(data.event).startsWith("FINISH")) {
          session = { event: String(data.event), wabaId: data.data?.waba_id, phoneNumberId: data.data?.phone_number_id };
        } else canceled = true;
      } catch {
        // mensagens de outras partes do SDK
      }
    };
    window.addEventListener("message", onMessage);

    // O SDK exige um callback síncrono; o resto roda em seguida.
    fb.login(
      (response) => {
        const code = response?.authResponse?.code;
        void (async () => {
          // A mensagem com a conta pode chegar um pouco depois do código.
          for (let i = 0; i < 20 && !session && code; i++) await new Promise((r) => setTimeout(r, 150));
          window.removeEventListener("message", onMessage);
          setBusy(false);
          const s = session as Session | null;
          if (!code || !s) return onError(canceled || !code ? "Conexão cancelada na Meta." : "A Meta não informou a conta escolhida. Tente de novo.");
          if (s.event === "FINISH_ONLY_WABA") return onError("Nenhum número foi escolhido na Meta. Conecte de novo e escolha o número.");
          if (!s.wabaId) return onError("A Meta não informou a conta do WhatsApp. Tente de novo.");
          onResult({ code, wabaId: s.wabaId, phoneNumberId: s.phoneNumberId ?? "", coexistence: s.event === "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING" });
        })();
      },
      {
        config_id: configId,
        response_type: "code",
        override_default_response_type: true,
        // Oferece conectar o número que já está no app WhatsApp Business (coexistência).
        extras: { setup: {}, featureType: "whatsapp_business_app_onboarding", sessionInfoVersion: "3" },
      },
    );
  }

  return (
    <Button variant="primary" loading={busy} disabled={disabled} onClick={() => void start()}>
      Conectar com a Meta
    </Button>
  );
}
