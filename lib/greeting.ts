import { formatInTimeZone } from "date-fns-tz";
import { ptBR } from "date-fns/locale";
import { TIMEZONE } from "@/lib/format";

// Saudação da tela de entrada, no horário de Teresina: personaliza o começo do dia de cada pessoa.

const DAY_LINES: Record<number, string> = {
  0: "Bom domingo. Se precisar, o Orvya está aqui.",
  1: "Boas vendas nesta segunda-feira. Que a semana comece forte.",
  2: "Boas vendas nesta terça-feira.",
  3: "Meio da semana. Boas vendas nesta quarta-feira.",
  4: "Boas vendas nesta quinta-feira. A reta final começa agora.",
  5: "Boas vendas nesta sexta-feira. Feche a semana com chave de ouro.",
  6: "Boas vendas neste sábado.",
};

export function greeting(now = new Date()) {
  const hour = Number(formatInTimeZone(now, TIMEZONE, "H"));
  const weekday = Number(formatInTimeZone(now, TIMEZONE, "i")) % 7; // ISO: 1 = segunda … 7 = domingo
  const hello = hour < 5 ? "Boa noite" : hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";
  return {
    hello,
    line: DAY_LINES[weekday]!,
    date: formatInTimeZone(now, TIMEZONE, "EEEE, d 'de' MMMM", { locale: ptBR }),
  };
}
