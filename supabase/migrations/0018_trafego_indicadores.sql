-- =====================================================================
-- Orvya — Tráfego: indicadores por anúncio, metas por cliente e relatórios.
--
-- - ad_ad_daily: desempenho por anúncio e por dia (Meta), para custo por conversa,
--   CTR e CPM de cada criativo.
-- - ad_ad_window: retrato dos últimos 7 dias por anúncio, com a frequência e o alcance
--   que a Meta calcula para o período (frequência não pode ser somada dia a dia).
-- - ad_ads ganha situação, miniatura e data de criação do anúncio.
-- - traffic_goals: metas da gestora por empresa (calibram os alertas).
-- - traffic_reports: relatórios diário e semanal; rascunho até a gestora liberar.
--   O cliente abre pelo link (share_token), lido só no servidor.
-- Tudo só do administrador da plataforma, como o restante do tráfego.
-- Pode ser executado mais de uma vez.
-- =====================================================================

create table if not exists public.ad_ad_daily (
  ad_account_id  uuid not null references public.ad_accounts (id) on delete cascade,
  company_id     uuid not null references public.companies (id) on delete cascade,
  date           date not null,
  ad_id          text not null,
  campaign_id    text not null,
  spend          numeric(14, 2) not null default 0,
  impressions    bigint not null default 0,
  reach          bigint not null default 0,
  clicks         bigint not null default 0,          -- cliques no link (para o WhatsApp, o site...)
  meta_leads     int not null default 0,
  conversations  int not null default 0,
  primary key (ad_account_id, date, ad_id)
);
create index if not exists ad_ad_daily_company_idx on public.ad_ad_daily (company_id, date);

create table if not exists public.ad_ad_window (
  ad_account_id  uuid not null references public.ad_accounts (id) on delete cascade,
  company_id     uuid not null references public.companies (id) on delete cascade,
  ad_id          text not null,
  days           int not null default 7,
  since          date not null,
  until          date not null,
  spend          numeric(14, 2) not null default 0,
  impressions    bigint not null default 0,
  reach          bigint not null default 0,
  frequency      numeric(8, 2),
  clicks         bigint not null default 0,
  conversations  int not null default 0,
  updated_at     timestamptz not null default now(),
  primary key (ad_account_id, ad_id, days)
);
create index if not exists ad_ad_window_company_idx on public.ad_ad_window (company_id);

alter table public.ad_ads
  add column if not exists status         text,          -- effective_status da Meta (ACTIVE, PAUSED...)
  add column if not exists thumbnail_url  text,
  add column if not exists created_time   timestamptz,
  add column if not exists adset_name     text;

create table if not exists public.traffic_goals (
  company_id                 uuid primary key references public.companies (id) on delete cascade,
  cost_per_conversation_max  numeric(10, 2),   -- custo por conversa máximo aceitável
  cpl_max                    numeric(10, 2),   -- custo por lead real máximo
  cost_per_sale_max          numeric(12, 2),
  roas_min                   numeric(6, 2),
  frequency_max              numeric(4, 1) not null default 3.0,
  ctr_min                    numeric(5, 2) not null default 0.8,   -- % de cliques no link
  updated_at                 timestamptz not null default now()
);

create table if not exists public.traffic_reports (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete cascade,
  kind          text not null check (kind in ('diario', 'semanal')),
  period_start  date not null,
  period_end    date not null,
  status        text not null default 'rascunho' check (status in ('rascunho', 'liberado')),
  data          jsonb not null,                   -- números e alertas no momento em que o relatório foi gerado
  notes_done    text,                             -- "o que fizemos", escrito pela gestora
  notes_next    text,                             -- "próximos passos"
  hidden_alerts text[] not null default '{}',     -- alertas que a gestora tirou do relatório do cliente
  share_token   text not null unique default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  created_at    timestamptz not null default now(),
  released_at   timestamptz,
  unique (company_id, kind, period_start, period_end)
);
create index if not exists traffic_reports_company_idx on public.traffic_reports (company_id, created_at desc);

alter table public.ad_ad_daily      enable row level security;
alter table public.ad_ad_window     enable row level security;
alter table public.traffic_goals    enable row level security;
alter table public.traffic_reports  enable row level security;

drop policy if exists ad_ad_daily_admin on public.ad_ad_daily;
create policy ad_ad_daily_admin on public.ad_ad_daily for select to authenticated
  using (public.is_platform_admin());
drop policy if exists ad_ad_window_admin on public.ad_ad_window;
create policy ad_ad_window_admin on public.ad_ad_window for select to authenticated
  using (public.is_platform_admin());
drop policy if exists traffic_goals_admin on public.traffic_goals;
create policy traffic_goals_admin on public.traffic_goals for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());
drop policy if exists traffic_reports_admin on public.traffic_reports;
create policy traffic_reports_admin on public.traffic_reports for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());
