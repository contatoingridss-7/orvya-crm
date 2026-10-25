/** Menu de boas-vindas do Direct: opções em botões de resposta rápida, todas levando ao WhatsApp. */

export const MENU_OTHERS = "Outros";
/** Limite do Instagram para o texto de cada botão. */
export const MENU_OPTION_MAX = 20;
/** Prefixo do payload do botão: "WA:<posição>". */
const PAYLOAD_PREFIX = "WA:";

/** Opções na ordem em que aparecem; "Outros" sempre por último. */
export function menuOptions(options: string[]): string[] {
  const clean = options.map((o) => o.trim()).filter((o) => o && o.toLowerCase() !== MENU_OTHERS.toLowerCase());
  return [...clean, MENU_OTHERS];
}

export function menuQuickReplies(options: string[]): { title: string; payload: string }[] {
  return menuOptions(options).map((title, i) => ({ title: title.slice(0, MENU_OPTION_MAX), payload: `${PAYLOAD_PREFIX}${i}` }));
}

/** Botão tocado → opção escolhida (ou null, se não for do menu). */
export function menuChoice(options: string[], payload: string | undefined): string | null {
  if (!payload?.startsWith(PAYLOAD_PREFIX)) return null;
  const i = Number(payload.slice(PAYLOAD_PREFIX.length));
  return Number.isInteger(i) ? (menuOptions(options)[i] ?? null) : null;
}

/** Link do WhatsApp com a mensagem já escrita (o assunto chega junto no Orvya). */
export function whatsappLink(phone: string, topic: string | null): string {
  const digits = phone.replace(/\D/g, "");
  const text = topic && topic !== MENU_OTHERS ? `Olá! Vim pelo Instagram e quero saber sobre ${topic}.` : "Olá! Vim pelo Instagram.";
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

export const fillLinkReply = (template: string, link: string) => (template.includes("{link}") ? template.replace("{link}", link) : `${template} ${link}`);
