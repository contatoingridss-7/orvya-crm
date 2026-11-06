-- =====================================================================
-- Orvya — Instagram Direct só com quem passou pela triagem (pedido de 05/11/2026).
--
-- Antes: toda mensagem do Direct virava conversa e lead (inclusive equipe, sócios e
-- clientes antigos). Agora: só entra no Orvya quem veio de anúncio ou escreveu uma
-- palavra-chave (respostas automáticas ou rotas de funil). O resto recebe o menu de
-- boas-vindas e continua só no app do Instagram.
--
-- contacts.crm_ignored: contato que nunca entra no Orvya (ex.: o dono, a equipe).
-- ig_triage: quem já recebeu o menu (para mandar uma vez só), sem criar contato.
-- Pode ser executado mais de uma vez.
-- =====================================================================

alter table public.contacts add column if not exists crm_ignored boolean not null default false;

create table if not exists public.ig_triage (
  account_id    uuid not null references public.instagram_accounts (id) on delete cascade,
  igsid         text not null,
  menu_sent_at  timestamptz not null default now(),
  primary key (account_id, igsid)
);
-- Só o servidor (webhook) usa; sem acesso de usuário.
alter table public.ig_triage enable row level security;
