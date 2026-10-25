"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { Panel } from "@/components/ui/panel";
import { Pill } from "@/components/ui/pill";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { createIgReply, deleteIgReply, toggleIgReply, type ActionResult } from "./ig-actions";

export type IgReply = { id: string; trigger: "welcome" | "dm_keyword" | "comment_keyword"; keywords: string[]; reply: string; active: boolean };

const TRIGGER: Record<IgReply["trigger"], { title: string; hint: string }> = {
  welcome: { title: "Boas-vindas simples", hint: "Primeira mensagem no Direct. Só vale com o menu de boas-vindas desligado." },
  dm_keyword: { title: "Palavra-chave no Direct", hint: "A mensagem do cliente contém uma das palavras." },
  comment_keyword: { title: "Comentário que vira mensagem privada", hint: "Comentário num post com a palavra recebe a resposta no Direct (uma por comentário, até 7 dias)." },
};
const ORDER: IgReply["trigger"][] = ["welcome", "dm_keyword", "comment_keyword"];

/** Respostas automáticas do Instagram. A mesma pessoa não recebe a mesma resposta duas vezes em 12 horas. */
export function IgRepliesManager({ slug, replies, connected, loadError }: { slug: string; replies: IgReply[]; connected: boolean; loadError: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const [trigger, setTrigger] = useState<IgReply["trigger"]>("dm_keyword");

  function run(fn: () => Promise<ActionResult>) {
    start(async () => {
      const r = await fn();
      toast(r.ok ? r.message : r.error, r.ok ? "ok" : "bad");
      if (r.ok) router.refresh();
    });
  }

  function onCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    setError(undefined);
    start(async () => {
      const r = await createIgReply(slug, { trigger, keywords: String(f.get("keywords") ?? ""), reply: String(f.get("reply") ?? "") });
      if (r.ok) {
        toast(r.message, "ok");
        form.reset();
        router.refresh();
      } else setError(r.error);
    });
  }

  return (
    <Panel
      title="Respostas automáticas do Instagram"
      subtitle="Respondem na hora pelo Direct, a qualquer hora. Depois a conversa segue com a equipe em Conversas."
    >
      {loadError && <Notice tone="bad">Não foi possível carregar. Rode a migration 0013 no Supabase.</Notice>}
      {!connected && !loadError && <Notice>Valem quando o Instagram estiver conectado em Canais e integrações.</Notice>}

      <div className="mt-3 grid gap-4">
        {ORDER.map((t) => {
          const items = replies.filter((r) => r.trigger === t);
          if (!items.length) return null;
          return (
            <section key={t}>
              <h3 className="mb-1 text-[13px] font-[650]">{TRIGGER[t].title}</h3>
              <div className="row-list">
                {items.map((r) => (
                  <div key={r.id} className={`flex flex-wrap items-start gap-2.5 py-2 ${r.active ? "" : "opacity-55"}`}>
                    <div className="grid min-w-0 flex-1 gap-1">
                      {r.keywords.length > 0 && (
                        <span className="flex flex-wrap gap-1">
                          {r.keywords.map((k) => (
                            <Pill key={k}>{k}</Pill>
                          ))}
                        </span>
                      )}
                      <p className="m-0 text-[13.5px] whitespace-pre-line">{r.reply}</p>
                    </div>
                    <Switch label={`${r.active ? "Desligar" : "Ligar"} resposta`} checked={r.active} disabled={pending} onChange={(e) => run(() => toggleIgReply(slug, r.id, e.target.checked))} />
                    <Button size="sm" variant="ghost" className="danger" disabled={pending} onClick={() => run(() => deleteIgReply(slug, r.id))}>
                      Excluir
                    </Button>
                  </div>
                ))}
              </div>
            </section>
          );
        })}
        {replies.length === 0 && !loadError && <div className="empty">Nenhuma resposta automática ainda.</div>}
      </div>

      <h3 className="mt-5 mb-2.5 text-[13px] font-[650]">Nova resposta</h3>
      <form onSubmit={onCreate} className="grid gap-2.5">
        <div className="grid gap-2.5 sm:grid-cols-2">
          <SelectField label="Quando" value={trigger} onChange={(e) => setTrigger(e.target.value as IgReply["trigger"])} hint={TRIGGER[trigger].hint}>
            {ORDER.map((t) => (
              <option key={t} value={t}>
                {TRIGGER[t].title}
              </option>
            ))}
          </SelectField>
          {trigger !== "welcome" && (
            <TextField label="Palavras-chave" name="keywords" required placeholder="Ex.: preço, valor, cpap" hint="Separe por vírgula. Acento e maiúscula não importam." />
          )}
        </div>
        <TextAreaField
          label="Resposta"
          name="reply"
          required
          maxLength={900}
          rows={3}
          placeholder="Ex.: Oi! Obrigado pelo contato. Já vamos te atender por aqui; se preferir, chame no WhatsApp (86) 0000-0000."
          hint="Sem preço nem condição comercial: isso a equipe responde."
        />
        <div>
          <Button type="submit" variant="primary" loading={pending}>
            Incluir
          </Button>
        </div>
        {error && <Notice tone="bad">{error}</Notice>}
      </form>
    </Panel>
  );
}
