"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { SelectField, TextAreaField } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { Panel } from "@/components/ui/panel";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { fillLinkReply, MENU_OPTION_MAX, MENU_OTHERS, menuOptions, whatsappLink } from "@/lib/instagram/menu";
import { saveIgMenu } from "./ig-actions";

export type IgMenu = { enabled: boolean; intro: string; options: string[]; linkReply: string; whatsappNumberId: string | null };
export type IgMenuNumber = { id: string; label: string; phone: string };

const MAX_OPTIONS = 12;

/**
 * Menu de boas-vindas do Direct: na primeira mensagem, opções em botões; qualquer opção
 * responde com o link do WhatsApp da empresa, com o assunto já escrito.
 */
export function IgMenuManager({ slug, menu, numbers, loadError }: { slug: string; menu: IgMenu | null; numbers: IgMenuNumber[]; loadError: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [enabled, setEnabled] = useState(menu?.enabled ?? true);
  const [intro, setIntro] = useState(menu?.intro ?? "Olá! Sobre o que você quer falar? Toque em uma opção:");
  const [options, setOptions] = useState<string[]>(menu?.options.length ? menu.options : ["", "", "", ""]);
  const [linkReply, setLinkReply] = useState(
    menu?.linkReply ?? "Para agilizar seu atendimento, nosso canal principal é o WhatsApp. Toque no link e fale direto com a nossa equipe: {link}",
  );
  const [numberId, setNumberId] = useState(menu?.whatsappNumberId ?? "");
  const [error, setError] = useState<string>();

  // Número do link: o escolhido ou o primeiro brasileiro conectado (mesma regra do servidor).
  const linkNumber = numbers.find((n) => n.id === numberId) ?? numbers.find((n) => n.phone.replace(/\D/g, "").startsWith("55"));
  const preview = menuOptions(options);
  const sample = preview[0] && preview[0] !== MENU_OTHERS ? preview[0] : null;

  function setOption(i: number, v: string) {
    setOptions((o) => o.map((x, j) => (j === i ? v : x)));
  }

  function save() {
    setError(undefined);
    start(async () => {
      const r = await saveIgMenu(slug, { enabled, intro, options, linkReply, whatsappNumberId: numberId });
      if (r.ok) {
        toast(r.message, "ok");
        router.refresh();
      } else setError(r.error);
    });
  }

  return (
    <Panel
      title="Menu de boas-vindas do Instagram"
      subtitle="Na primeira mensagem no Direct, a pessoa escolhe o assunto num botão e recebe o link do WhatsApp, que cai no Orvya com o assunto já escrito."
      actions={<Switch label={enabled ? "Desligar menu" : "Ligar menu"} checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />}
    >
      {loadError && <Notice tone="bad">Não foi possível carregar. Rode a migration 0013 no Supabase.</Notice>}
      {!linkNumber && <Notice tone="warn">Nenhum número de WhatsApp conectado: sem ele o menu não é enviado.</Notice>}

      <div className={`grid gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] ${enabled ? "" : "opacity-60"}`}>
        <div className="grid gap-3">
          <TextAreaField label="1. Boas-vindas" value={intro} onChange={(e) => setIntro(e.target.value)} maxLength={900} rows={2} />

          <fieldset className="m-0 grid gap-2 border-0 p-0">
            <legend className="mb-1 text-[13px] font-[650]">2. Opções (botões)</legend>
            {options.map((o, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  className="inp min-w-0 flex-1"
                  value={o}
                  maxLength={MENU_OPTION_MAX}
                  placeholder={`Opção ${i + 1}`}
                  aria-label={`Opção ${i + 1}`}
                  onChange={(e) => setOption(i, e.target.value)}
                />
                <span className="w-10 text-right text-xs text-muted tabular-nums">
                  {o.length}/{MENU_OPTION_MAX}
                </span>
                <Button size="sm" variant="ghost" aria-label={`Remover opção ${i + 1}`} disabled={options.length <= 1} onClick={() => setOptions((x) => x.filter((_, j) => j !== i))}>
                  Remover
                </Button>
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-2">
              <span className="inp !w-auto flex-1 text-muted">{MENU_OTHERS} (sempre por último)</span>
              {options.length < MAX_OPTIONS && (
                <Button size="sm" onClick={() => setOptions((x) => [...x, ""])}>
                  Incluir opção
                </Button>
              )}
            </div>
          </fieldset>

          <TextAreaField
            label="3. Resposta com o link do WhatsApp"
            value={linkReply}
            onChange={(e) => setLinkReply(e.target.value)}
            maxLength={900}
            rows={2}
            hint="{link} é trocado pelo link do WhatsApp. Vale para todas as opções."
          />

          <SelectField label="Número do link" value={numberId} onChange={(e) => setNumberId(e.target.value)}>
            <option value="">Automático (primeiro número brasileiro conectado)</option>
            {numbers.map((n) => (
              <option key={n.id} value={n.id}>
                {n.label} · {n.phone}
              </option>
            ))}
          </SelectField>

          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" loading={pending} onClick={save}>
              Salvar menu
            </Button>
            {error && <Notice tone="bad">{error}</Notice>}
          </div>
        </div>

        {/* Prévia de como aparece no Direct */}
        <div className="ig-preview" aria-label="Prévia no Instagram">
          <p className="m-0 text-xs text-muted">Prévia no Direct</p>
          <div className="ig-bubble">{intro}</div>
          <div className="flex flex-wrap justify-end gap-1.5">
            {preview.map((o, i) => (
              <span key={`${o}-${i}`} className="ig-chip">
                {o}
              </span>
            ))}
          </div>
          {sample && <div className="ig-bubble ig-me">{sample}</div>}
          <div className="ig-bubble break-words">{fillLinkReply(linkReply, linkNumber ? whatsappLink(linkNumber.phone, sample) : "(link do WhatsApp)")}</div>
        </div>
      </div>
    </Panel>
  );
}
