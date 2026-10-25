-- =====================================================================
-- Orvya — Tráfego pago (área restrita ao administrador da plataforma).
--
-- Contas de anúncio por empresa (Meta agora; Google depois do token de desenvolvedor),
-- desempenho diário por campanha puxado da API de Marketing, mapa anúncio → campanha
-- (para ligar o lead que veio de um anúncio de clique para o WhatsApp à campanha),
-- saldo e situação da conta para os alertas.
--
-- Leitura e escrita: só administrador da plataforma. O token fica em ad_credentials,
-- sem política nenhuma (só o servidor, com service_role, lê).
-- Pode ser executado mais de uma vez.
-- =====================================================================

create table if not exists public.ad_accounts (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies (id) on delete cascade,
  platform           text not null default 'meta' check (platform in ('meta', 'google')),
  external_id        text not null,                 -- Meta: só os números (sem "act_")
  name               text not null,
  currency           text,
  timezone           text,
  is_prepay          boolean,
  account_status     int,                           -- 1 ativa, 2 desativada, 3 pagamento pendente, 9 período de tolerância...
  disable_reason     int,
  amount_spent       numeric(14, 2),                -- gasto acumulado (contra o limite de gastos)
  spend_cap          numeric(14, 2),                -- limite de gastos (0/null = sem limite)
  balance_due        numeric(14, 2),                -- valor a pagar (conta pós-paga)
  available_balance  numeric(14, 2),                -- saldo disponível (pré-paga: boleto/PIX), quando a Meta informa
  funding_display    text,                          -- texto da forma de pagamento, como a Meta mostra
  low_balance_days   int not null default 3 check (low_balance_days between 1 and 30),
  last_synced_at     timestamptz,
  sync_error         text,
  active             boolean not null default true,
  created_at         timestamptz not null default now(),
  unique (platform, external_id)
);
create index if not exists ad_accounts_company_idx on public.ad_accounts (company_id);

create table if not exists public.ad_credentials (
  ad_account_id  uuid primary key references public.ad_accounts (id) on delete cascade,
  access_token   text not null,
  updated_at     timestamptz not null default now()
);

create table if not exists public.ad_campaign_daily (
  ad_account_id  uuid not null references public.ad_accounts (id) on delete cascade,
  company_id     uuid not null references public.companies (id) on delete cascade,
  date           date not null,
  campaign_id    text not null,
  campaign_name  text not null,
  spend          numeric(14, 2) not null default 0,
  impressions    bigint not null default 0,
  reach          bigint not null default 0,
  clicks         bigint not null default 0,
  meta_leads     int not null default 0,            -- leads que a Meta conta (formulário/pixel)
  conversations  int not null default 0,            -- conversas iniciadas no WhatsApp/Messenger pela Meta
  primary key (ad_account_id, date, campaign_id)
);
create index if not exists ad_campaign_daily_company_idx on public.ad_campaign_daily (company_id, date);

create table if not exists public.ad_ads (
  ad_account_id  uuid not null references public.ad_accounts (id) on delete cascade,
  ad_id          text not null,
  campaign_id    text not null,
  ad_name        text,
  primary key (ad_account_id, ad_id)
);
create index if not exists ad_ads_ad_idx on public.ad_ads (ad_id);

alter table public.ad_accounts       enable row level security;
alter table public.ad_credentials    enable row level security;
alter table public.ad_campaign_daily enable row level security;
alter table public.ad_ads            enable row level security;

drop policy if exists ad_accounts_admin on public.ad_accounts;
create policy ad_accounts_admin on public.ad_accounts for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());
drop policy if exists ad_campaign_daily_admin on public.ad_campaign_daily;
create policy ad_campaign_daily_admin on public.ad_campaign_daily for select to authenticated
  using (public.is_platform_admin());
drop policy if exists ad_ads_admin on public.ad_ads;
create policy ad_ads_admin on public.ad_ads for select to authenticated
  using (public.is_platform_admin());
-- ad_credentials: sem política = só service_role.
revoke all on public.ad_credentials from anon, authenticated;
