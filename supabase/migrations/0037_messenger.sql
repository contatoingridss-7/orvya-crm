-- =====================================================================
-- Orvya — Messenger (mensagens da Página do Facebook) e Direct completo (pedido de 06/11/2026).
--
-- - contacts.messenger_id: identificador da pessoa no Messenger (PSID da Página).
-- - Origem "Messenger" para os leads que chegam pela Página.
-- O Instagram volta a importar todas as conversas do Direct (só os contatos marcados com
-- "Tirar do Orvya" ficam de fora) — mudança no código, sem efeito no banco.
-- Pode ser executado mais de uma vez.
-- =====================================================================

alter table public.contacts add column if not exists messenger_id text;
create unique index if not exists contacts_company_messenger_idx
  on public.contacts (company_id, messenger_id) where messenger_id is not null;

insert into public.lead_sources (company_id, name, position)
select c.id, 'Messenger', 90 from public.companies c
on conflict (company_id, name) do nothing;
