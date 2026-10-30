-- =====================================================================
-- Orvya — Resposta automática fora do horário (WhatsApp).
--
-- Quando o cliente escreve fora do expediente, o Orvya responde uma vez com o horário
-- de atendimento. A resposta vai dentro da janela de 24 h (sem custo e sem modelo) e a
-- conversa continua na fila "Precisa de mim" para a equipe responder no dia seguinte.
--
-- hours: dia da semana ISO (1 = segunda ... 7 = domingo) → [abertura, fechamento].
-- Dia ausente = fechado. Fuso de Teresina (America/Fortaleza).
-- Pode ser executado mais de uma vez.
-- =====================================================================

create table if not exists public.whatsapp_after_hours (
  company_id  uuid primary key references public.companies (id) on delete cascade,
  enabled     boolean not null default true,
  hours       jsonb not null default '{"1":["08:00","18:00"],"2":["08:00","18:00"],"3":["08:00","18:00"],"4":["08:00","18:00"],"5":["08:00","18:00"],"6":["08:00","12:00"]}'::jsonb,
  message     text not null check (char_length(message) between 1 and 900),   -- {retorno} vira "amanhã a partir das 8h"...
  updated_at  timestamptz not null default now()
);

alter table public.whatsapp_after_hours enable row level security;
drop policy if exists whatsapp_after_hours_select on public.whatsapp_after_hours;
create policy whatsapp_after_hours_select on public.whatsapp_after_hours for select to authenticated
  using (public.has_company_access(company_id));
drop policy if exists whatsapp_after_hours_write on public.whatsapp_after_hours;
create policy whatsapp_after_hours_write on public.whatsapp_after_hours for all to authenticated
  using (public.can_configure(company_id)) with check (public.can_configure(company_id));

-- Horário combinado com a gestão em 29/10/2026: segunda a sexta, 8h às 18h; sábado, 8h às 12h.
insert into public.whatsapp_after_hours (company_id, message)
select c.id,
       'Olá! Aqui é a ' || c.name || '. Recebemos sua mensagem! Nosso atendimento é de segunda a sexta, das 8h às 18h, e aos sábados, das 8h às 12h. Um consultor fala com você {retorno}.'
from public.companies c
on conflict (company_id) do nothing;
