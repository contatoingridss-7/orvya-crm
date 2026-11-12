-- =====================================================================
-- Orvya — Locais salvos da empresa (loja, filial, depósito) para enviar como localização
-- nas conversas (WhatsApp: cartão com mapa; Instagram e Messenger: texto com o link do mapa).
--
-- A equipe da empresa lê; só a gestão cadastra e exclui. Sem esta migration, enviar a
-- localização atual, um link do Google Maps e pedir a localização do cliente já funcionam;
-- só a lista de locais salvos fica vazia.
-- Pode ser executado mais de uma vez.
-- =====================================================================

create table if not exists public.company_places (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 80),
  address     text check (address is null or char_length(address) <= 200),
  latitude    double precision not null check (latitude between -90 and 90),
  longitude   double precision not null check (longitude between -180 and 180),
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (company_id, name)
);
create index if not exists company_places_company_idx on public.company_places (company_id, name);

alter table public.company_places enable row level security;

drop policy if exists company_places_select on public.company_places;
create policy company_places_select on public.company_places for select to authenticated
  using (public.has_company_access(company_id));
drop policy if exists company_places_write on public.company_places;
create policy company_places_write on public.company_places for all to authenticated
  using (public.is_company_manager(company_id)) with check (public.is_company_manager(company_id));
