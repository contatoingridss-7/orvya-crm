-- =====================================================================
-- Orvya — Google Ads no Tráfego.
--
-- A conexão é pelo login da Google (OAuth) da administradora: o acesso de longa
-- duração (refresh token) fica em ad_credentials.access_token, só no servidor.
-- Conta acessada por uma conta de administrador (MCC) guarda o número dela em
-- login_customer_id, que a API exige nesses casos.
--
-- ad_oauth_grants: acesso recém-autorizado, enquanto a administradora escolhe a
-- conta (sem política: só o servidor lê; vale por 1 hora).
-- Pode ser executado mais de uma vez.
-- =====================================================================

alter table public.ad_accounts
  add column if not exists login_customer_id text;

create table if not exists public.ad_oauth_grants (
  id             uuid primary key default gen_random_uuid(),
  platform       text not null check (platform in ('google')),
  refresh_token  text not null,
  created_by     uuid not null references public.profiles (id) on delete cascade,
  created_at     timestamptz not null default now()
);

alter table public.ad_oauth_grants enable row level security;
revoke all on public.ad_oauth_grants from anon, authenticated;
