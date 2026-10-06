-- =====================================================================
-- Orvya — esquema inicial
-- Multiempresa (IC Supra, LocPress), perfis admin/gestor/vendedor,
-- WhatsApp Cloud API (até 2 números por empresa), agente de IA.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------
create type public.member_role       as enum ('gestor', 'vendedor');
create type public.stage_kind        as enum ('open', 'won', 'lost');
create type public.channel_type      as enum ('whatsapp', 'instagram', 'messenger');
create type public.lead_temperature  as enum ('quente', 'morno', 'frio');
create type public.customer_type     as enum ('B2C', 'B2B');
create type public.msg_direction     as enum ('in', 'out');
create type public.msg_sender        as enum ('contact', 'ai', 'user', 'system');
create type public.msg_status        as enum ('received', 'queued', 'sent', 'delivered', 'read', 'failed');
create type public.template_category as enum ('MARKETING', 'UTILITY', 'AUTHENTICATION');
create type public.template_status   as enum ('draft', 'pending', 'approved', 'rejected', 'paused', 'disabled');
create type public.number_status     as enum ('off', 'pending', 'connected', 'error');
create type public.activity_kind     as enum ('note', 'stage_change', 'automation', 'assignment', 'ai', 'system');

-- ---------------------------------------------------------------------
-- Utilitário: updated_at
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------
-- Empresas, perfis e vínculos
-- ---------------------------------------------------------------------
create table public.companies (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  name        text not null,
  short_name  text not null,
  segment     text,
  timezone    text not null default 'America/Fortaleza',
  created_at  timestamptz not null default now()
);

create table public.profiles (
  id                 uuid primary key references auth.users (id) on delete cascade,
  full_name          text,
  email              text,
  is_platform_admin  boolean not null default false,
  active             boolean not null default true,
  theme              text check (theme in ('light', 'dark')),
  created_at         timestamptz not null default now()
);

create table public.memberships (
  user_id     uuid not null references public.profiles (id) on delete cascade,
  company_id  uuid not null references public.companies (id) on delete cascade,
  role        public.member_role not null,
  created_at  timestamptz not null default now(),
  primary key (user_id, company_id)
);
create index memberships_company_idx on public.memberships (company_id);

-- Cria o perfil automaticamente quando um usuário é criado/convidado
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- Funções de autorização (usadas pelo RLS)
-- ---------------------------------------------------------------------
create or replace function public.is_platform_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select p.is_platform_admin and p.active from public.profiles p where p.id = (select auth.uid())),
    false);
$$;

create or replace function public.has_company_access(cid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_platform_admin() or exists (
    select 1
    from public.memberships m
    join public.profiles p on p.id = m.user_id
    where m.user_id = (select auth.uid()) and m.company_id = cid and p.active);
$$;

create or replace function public.is_company_manager(cid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_platform_admin() or exists (
    select 1
    from public.memberships m
    join public.profiles p on p.id = m.user_id
    where m.user_id = (select auth.uid()) and m.company_id = cid and m.role = 'gestor' and p.active);
$$;

-- Vendedor vê o que é dele e o que está sem responsável; gestor/admin veem tudo da empresa
create or replace function public.can_see_owned(cid uuid, owner uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_company_manager(cid)
      or (public.has_company_access(cid) and (owner is null or owner = (select auth.uid())));
$$;

create or replace function public.shares_company(other uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.memberships a
    join public.memberships b on a.company_id = b.company_id
    where a.user_id = (select auth.uid()) and b.user_id = other);
$$;

-- ---------------------------------------------------------------------
-- Configuração comercial
-- ---------------------------------------------------------------------
create table public.pipelines (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  key         text not null,
  name        text not null,
  hint        text,
  position    int not null default 0,
  created_at  timestamptz not null default now(),
  unique (company_id, key)
);

create table public.stages (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete cascade,
  pipeline_id  uuid not null references public.pipelines (id) on delete cascade,
  key          text not null,
  name         text not null,
  kind         public.stage_kind not null default 'open',
  position     int not null default 0,
  unique (pipeline_id, key)
);
create index stages_pipeline_idx on public.stages (pipeline_id, position);

create table public.custom_fields (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete cascade,
  pipeline_id  uuid not null references public.pipelines (id) on delete cascade,
  key          text not null,
  label        text not null,
  field_type   text not null check (field_type in ('text', 'number', 'date', 'select')),
  options      text[],
  position     int not null default 0,
  full_width   boolean not null default false,
  unique (pipeline_id, key)
);

create table public.lead_sources (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  name        text not null,
  position    int not null default 0,
  unique (company_id, name)
);

create table public.lost_reasons (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  name        text not null,
  position    int not null default 0,
  unique (company_id, name)
);

create table public.products (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies (id) on delete cascade,
  code              text,
  name              text not null,
  category          text,
  sale_price        numeric(12, 2),          -- null = sob consulta (IA passa para humano)
  rent_price_month  numeric(12, 2),          -- null = não alugamos
  stock             int not null default 0,
  rented_count      int not null default 0,
  promo_label       text,
  ai_notes          text,                    -- informações que a IA pode usar
  active            boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index products_company_idx on public.products (company_id, active);
create trigger products_updated before update on public.products for each row execute function public.set_updated_at();

create table public.automation_rules (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete cascade,
  pipeline_id  uuid not null references public.pipelines (id) on delete cascade,
  stage_id     uuid not null references public.stages (id) on delete cascade,
  task_title   text not null,
  due_in_days  int not null default 1 check (due_in_days >= 0),
  enabled      boolean not null default true,
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- WhatsApp: números e credenciais
-- ---------------------------------------------------------------------
create table public.whatsapp_numbers (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null references public.companies (id) on delete cascade,
  slot                 smallint not null check (slot between 1 and 2),   -- até 2 números por empresa
  label                text not null,
  display_phone        text,
  phone_number_id      text unique,      -- id do número na Cloud API
  waba_id              text,             -- WhatsApp Business Account
  default_pipeline_id  uuid references public.pipelines (id) on delete set null,
  status               public.number_status not null default 'off',
  quality_rating       text,
  connected_at         timestamptz,
  created_at           timestamptz not null default now(),
  unique (company_id, slot)
);

-- Sem políticas: só o service_role (servidor) lê e escreve
create table public.whatsapp_credentials (
  number_id     uuid primary key references public.whatsapp_numbers (id) on delete cascade,
  access_token  text not null,
  updated_at    timestamptz not null default now()
);

create table public.message_templates (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies (id) on delete cascade,
  name              text not null check (name ~ '^[a-z0-9_]+$'),
  language          text not null default 'pt_BR',
  category          public.template_category not null,
  status            public.template_status not null default 'draft',
  body              text not null,                 -- com {{1}}, {{2}}...
  variables         text[] not null default '{}',  -- ex.: {nome, produto}
  meta_template_id  text,
  rejected_reason   text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (company_id, name, language)
);
create trigger templates_updated before update on public.message_templates for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Contatos, leads e locação
-- ---------------------------------------------------------------------
create table public.contacts (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies (id) on delete cascade,
  name           text not null,
  phone_e164     text,                               -- +5586999990000
  email          text,
  org_name       text,
  customer_type  public.customer_type not null default 'B2C',
  document       text,                               -- CPF/CNPJ
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (company_id, phone_e164)
);
create trigger contacts_updated before update on public.contacts for each row execute function public.set_updated_at();

create table public.leads (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies (id) on delete cascade,
  contact_id       uuid not null references public.contacts (id) on delete cascade,
  pipeline_id      uuid not null references public.pipelines (id),
  stage_id         uuid not null references public.stages (id),
  owner_id         uuid references public.profiles (id) on delete set null,
  value            numeric(12, 2) not null default 0,
  temperature      public.lead_temperature not null default 'morno',
  source_id        uuid references public.lead_sources (id) on delete set null,
  utm              jsonb not null default '{}'::jsonb,   -- utm_*, gclid, fbclid
  ad_referral      jsonb,                                -- referral da Meta (clique para WhatsApp)
  score            int not null default 50 check (score between 0 and 100),
  custom           jsonb not null default '{}'::jsonb,   -- valores de custom_fields
  lost_reason      text,
  closed_at        timestamptz,
  last_contact_at  timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index leads_board_idx   on public.leads (company_id, pipeline_id, stage_id);
create index leads_owner_idx   on public.leads (owner_id);
create index leads_contact_idx on public.leads (contact_id);
create trigger leads_updated before update on public.leads for each row execute function public.set_updated_at();

create table public.lead_products (
  company_id  uuid not null references public.companies (id) on delete cascade,
  lead_id     uuid not null references public.leads (id) on delete cascade,
  product_id  uuid not null references public.products (id) on delete cascade,
  quantity    int not null default 1 check (quantity > 0),
  mode        text not null default 'venda' check (mode in ('venda', 'locacao')),
  primary key (lead_id, product_id, mode)
);

create table public.rental_contracts (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies (id) on delete cascade,
  lead_id           uuid not null references public.leads (id) on delete cascade,
  product_id        uuid references public.products (id) on delete set null,
  serial_number     text,
  start_date        date not null,
  end_date          date not null,
  monthly_value     numeric(12, 2) not null,
  delivery_address  text,
  status            text not null default 'ativo' check (status in ('ativo', 'encerrado', 'renovado')),
  reminders_sent    int[] not null default '{}',   -- marcos já avisados: 30, 15, 7
  created_at        timestamptz not null default now(),
  check (end_date >= start_date)
);
create index rentals_due_idx on public.rental_contracts (company_id, status, end_date);

-- ---------------------------------------------------------------------
-- Conversas e mensagens
-- ---------------------------------------------------------------------
create table public.conversations (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies (id) on delete cascade,
  contact_id          uuid not null references public.contacts (id) on delete cascade,
  lead_id             uuid references public.leads (id) on delete set null,
  channel             public.channel_type not null default 'whatsapp',
  whatsapp_number_id  uuid references public.whatsapp_numbers (id) on delete set null,
  assigned_to         uuid references public.profiles (id) on delete set null,
  ai_enabled          boolean not null default true,
  needs_human         boolean not null default false,
  needs_human_reason  text,
  ai_summary          text,
  last_inbound_at     timestamptz,   -- janela de 24 h = last_inbound_at + 24 h
  last_message_at     timestamptz,
  unread_count        int not null default 0,
  created_at          timestamptz not null default now(),
  unique nulls not distinct (company_id, contact_id, channel, whatsapp_number_id)
);
create index conversations_inbox_idx on public.conversations (company_id, last_message_at desc);
create index conversations_assigned_idx on public.conversations (assigned_to);

create table public.messages (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies (id) on delete cascade,
  conversation_id  uuid not null references public.conversations (id) on delete cascade,
  direction        public.msg_direction not null,
  sender           public.msg_sender not null,
  user_id          uuid references public.profiles (id) on delete set null,
  msg_type         text not null default 'text',   -- text, image, audio, document, video, template, interactive, location...
  body             text,
  template_name    text,
  media_path       text,                           -- caminho no bucket whatsapp-media
  media_mime       text,
  wa_message_id    text unique,                    -- idempotência
  status           public.msg_status not null default 'queued',
  error            jsonb,
  pricing          jsonb,                          -- vindo do webhook de status
  created_at       timestamptz not null default now()
);
create index messages_thread_idx on public.messages (conversation_id, created_at);

-- ---------------------------------------------------------------------
-- Tarefas e histórico
-- ---------------------------------------------------------------------
create table public.tasks (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies (id) on delete cascade,
  lead_id             uuid references public.leads (id) on delete cascade,
  title               text not null,
  due_at              timestamptz not null,
  owner_id            uuid references public.profiles (id) on delete set null,
  done_at             timestamptz,
  created_by          uuid references public.profiles (id) on delete set null,
  origin              text not null default 'manual' check (origin in ('manual', 'automation', 'system')),
  automation_rule_id  uuid references public.automation_rules (id) on delete set null,
  created_at          timestamptz not null default now()
);
create index tasks_open_idx on public.tasks (company_id, owner_id, due_at) where done_at is null;

create table public.activities (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  lead_id     uuid not null references public.leads (id) on delete cascade,
  kind        public.activity_kind not null,
  body        text not null,
  user_id     uuid references public.profiles (id) on delete set null,
  meta        jsonb,
  created_at  timestamptz not null default now()
);
create index activities_lead_idx on public.activities (lead_id, created_at desc);

-- ---------------------------------------------------------------------
-- IA, integrações e log de webhooks
-- ---------------------------------------------------------------------
create table public.ai_settings (
  company_id      uuid primary key references public.companies (id) on delete cascade,
  enabled         boolean not null default false,
  reply_model     text not null default 'claude-sonnet-5-5',
  support_model   text not null default 'claude-haiku-4-5-20251001',
  system_prompt   text not null default '',
  business_hours  jsonb not null default '{"tz":"America/Fortaleza","days":[1,2,3,4,5,6],"start":"07:30","end":"18:00","after_hours":"reply"}'::jsonb,
  handoff_rules   jsonb not null default '{}'::jsonb,
  max_discount    numeric(5, 2) not null default 0,
  updated_at      timestamptz not null default now()
);
create trigger ai_settings_updated before update on public.ai_settings for each row execute function public.set_updated_at();

create table public.integrations (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  kind        text not null,      -- meta_leads, meta_ctwa, meta_capi, google_leads, google_conv, site, instagram, messenger
  status      text not null default 'off' check (status in ('off', 'pending', 'on', 'error')),
  config      jsonb not null default '{}'::jsonb,   -- nada secreto aqui
  updated_at  timestamptz not null default now(),
  unique (company_id, kind)
);

-- Sem políticas: só o service_role
create table public.webhook_events (
  id            bigint generated always as identity primary key,
  source        text not null,
  payload       jsonb not null,
  received_at   timestamptz not null default now(),
  processed_at  timestamptz,
  error         text
);

-- ---------------------------------------------------------------------
-- Regras de negócio do lead (gatilhos)
-- ---------------------------------------------------------------------

-- Antes de gravar: etapa precisa ser do funil e da empresa; perda exige motivo; controla closed_at
create or replace function public.leads_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_kind public.stage_kind;
  v_pipeline uuid;
  v_company uuid;
begin
  select s.kind, s.pipeline_id, s.company_id into v_kind, v_pipeline, v_company
  from public.stages s where s.id = new.stage_id;

  if v_pipeline is null or v_pipeline <> new.pipeline_id or v_company <> new.company_id then
    raise exception 'Etapa não pertence ao funil ou à empresa do lead';
  end if;

  if v_kind = 'lost' and coalesce(btrim(new.lost_reason), '') = '' then
    raise exception 'Informe o motivo da perda';
  end if;

  if tg_op = 'INSERT' or new.stage_id is distinct from old.stage_id then
    if v_kind = 'open' then
      new.closed_at := null;
      new.lost_reason := null;
    else
      new.closed_at := coalesce(new.closed_at, now());
    end if;
  end if;

  return new;
end $$;

create trigger leads_guard_trg
  before insert or update of stage_id, pipeline_id, lost_reason on public.leads
  for each row execute function public.leads_guard();

-- Depois de mudar de etapa: histórico + tarefas das automações
create or replace function public.leads_after_stage_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_from text;
  v_to text;
  r record;
begin
  select name into v_from from public.stages where id = old.stage_id;
  select name into v_to   from public.stages where id = new.stage_id;

  insert into public.activities (company_id, lead_id, kind, body, user_id, meta)
  values (new.company_id, new.id, 'stage_change',
          'Etapa alterada de ' || coalesce(v_from, '?') || ' para ' || coalesce(v_to, '?')
            || case when new.lost_reason is not null then '. Motivo: ' || new.lost_reason else '' end,
          (select auth.uid()),
          jsonb_build_object('from', old.stage_id, 'to', new.stage_id));

  for r in
    select * from public.automation_rules
    where enabled and company_id = new.company_id and pipeline_id = new.pipeline_id and stage_id = new.stage_id
  loop
    insert into public.tasks (company_id, lead_id, title, due_at, owner_id, origin, automation_rule_id)
    values (new.company_id, new.id, r.task_title, now() + make_interval(days => r.due_in_days),
            new.owner_id, 'automation', r.id);

    insert into public.activities (company_id, lead_id, kind, body, meta)
    values (new.company_id, new.id, 'automation',
            'Automação criou a tarefa "' || r.task_title || '"',
            jsonb_build_object('rule_id', r.id));
  end loop;

  return new;
end $$;

create trigger leads_stage_change_trg
  after update of stage_id on public.leads
  for each row when (old.stage_id is distinct from new.stage_id)
  execute function public.leads_after_stage_change();

-- Troca de responsável fica registrada
create or replace function public.leads_after_owner_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_name text;
begin
  select full_name into v_name from public.profiles where id = new.owner_id;
  insert into public.activities (company_id, lead_id, kind, body, user_id)
  values (new.company_id, new.id, 'assignment',
          case when new.owner_id is null then 'Lead voltou para a fila sem responsável'
               else 'Responsável: ' || coalesce(v_name, 'usuário') end,
          (select auth.uid()));
  return new;
end $$;

create trigger leads_owner_change_trg
  after update of owner_id on public.leads
  for each row when (old.owner_id is distinct from new.owner_id)
  execute function public.leads_after_owner_change();

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.companies          enable row level security;
alter table public.profiles           enable row level security;
alter table public.memberships        enable row level security;
alter table public.pipelines          enable row level security;
alter table public.stages             enable row level security;
alter table public.custom_fields      enable row level security;
alter table public.lead_sources       enable row level security;
alter table public.lost_reasons       enable row level security;
alter table public.products           enable row level security;
alter table public.automation_rules   enable row level security;
alter table public.whatsapp_numbers   enable row level security;
alter table public.whatsapp_credentials enable row level security;
alter table public.message_templates  enable row level security;
alter table public.contacts           enable row level security;
alter table public.leads              enable row level security;
alter table public.lead_products      enable row level security;
alter table public.rental_contracts   enable row level security;
alter table public.conversations      enable row level security;
alter table public.messages           enable row level security;
alter table public.tasks              enable row level security;
alter table public.activities         enable row level security;
alter table public.ai_settings        enable row level security;
alter table public.integrations       enable row level security;
alter table public.webhook_events     enable row level security;
-- whatsapp_credentials e webhook_events ficam sem políticas = só service_role.

-- Empresas
create policy companies_select on public.companies for select to authenticated
  using (public.has_company_access(id));
create policy companies_admin on public.companies for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

-- Perfis: o próprio, colegas de empresa e admin
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or public.is_platform_admin() or public.shares_company(id));
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy profiles_admin on public.profiles for update to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());
-- Usuário comum só altera nome e tema; flags de admin/ativo só pelo admin (via service_role)
revoke update on public.profiles from authenticated;
grant update (full_name, theme) on public.profiles to authenticated;

-- Vínculos
create policy memberships_select on public.memberships for select to authenticated
  using (public.has_company_access(company_id));
create policy memberships_admin on public.memberships for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

-- Tabelas de configuração: membros leem, gestor/admin editam
do $$
declare t text;
begin
  foreach t in array array['pipelines','stages','custom_fields','lead_sources','lost_reasons','products','automation_rules']
  loop
    execute format('create policy %1$s_select on public.%1$s for select to authenticated using (public.has_company_access(company_id));', t);
    execute format('create policy %1$s_insert on public.%1$s for insert to authenticated with check (public.is_company_manager(company_id));', t);
    execute format('create policy %1$s_update on public.%1$s for update to authenticated using (public.is_company_manager(company_id)) with check (public.is_company_manager(company_id));', t);
    execute format('create policy %1$s_delete on public.%1$s for delete to authenticated using (public.is_company_manager(company_id));', t);
  end loop;
end $$;

-- Tabelas só do admin para escrita (membros leem)
do $$
declare t text;
begin
  foreach t in array array['whatsapp_numbers','message_templates','integrations']
  loop
    execute format('create policy %1$s_select on public.%1$s for select to authenticated using (public.has_company_access(company_id));', t);
    execute format('create policy %1$s_admin on public.%1$s for all to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin());', t);
  end loop;
end $$;

create policy ai_settings_select on public.ai_settings for select to authenticated
  using (public.is_company_manager(company_id));
create policy ai_settings_admin on public.ai_settings for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

-- Contatos: membros da empresa
create policy contacts_select on public.contacts for select to authenticated
  using (public.has_company_access(company_id));
create policy contacts_insert on public.contacts for insert to authenticated
  with check (public.has_company_access(company_id));
create policy contacts_update on public.contacts for update to authenticated
  using (public.has_company_access(company_id)) with check (public.has_company_access(company_id));
create policy contacts_delete on public.contacts for delete to authenticated
  using (public.is_company_manager(company_id));

-- Leads: vendedor vê os dele e os sem responsável; pode pegar para si, não pode passar para outro
create policy leads_select on public.leads for select to authenticated
  using (public.can_see_owned(company_id, owner_id));
create policy leads_insert on public.leads for insert to authenticated
  with check (public.has_company_access(company_id)
              and (public.is_company_manager(company_id) or owner_id is null or owner_id = (select auth.uid())));
create policy leads_update on public.leads for update to authenticated
  using (public.can_see_owned(company_id, owner_id))
  with check (public.is_company_manager(company_id) or owner_id = (select auth.uid()));
create policy leads_delete on public.leads for delete to authenticated
  using (public.is_company_manager(company_id));

-- Itens ligados ao lead: seguem a visibilidade do lead
do $$
declare t text;
begin
  foreach t in array array['lead_products','rental_contracts']
  loop
    execute format('create policy %1$s_select on public.%1$s for select to authenticated using (exists (select 1 from public.leads l where l.id = lead_id));', t);
    execute format('create policy %1$s_write on public.%1$s for all to authenticated using (exists (select 1 from public.leads l where l.id = lead_id)) with check (public.has_company_access(company_id) and exists (select 1 from public.leads l where l.id = lead_id));', t);
  end loop;
end $$;

-- Tarefas
create policy tasks_select on public.tasks for select to authenticated
  using (public.is_company_manager(company_id)
         or (public.has_company_access(company_id)
             and (owner_id = (select auth.uid()) or (lead_id is not null and exists (select 1 from public.leads l where l.id = lead_id)))));
create policy tasks_insert on public.tasks for insert to authenticated
  with check (public.has_company_access(company_id)
              and (public.is_company_manager(company_id) or owner_id = (select auth.uid())));
create policy tasks_update on public.tasks for update to authenticated
  using (public.is_company_manager(company_id) or owner_id = (select auth.uid()))
  with check (public.is_company_manager(company_id) or owner_id = (select auth.uid()));
create policy tasks_delete on public.tasks for delete to authenticated
  using (public.is_company_manager(company_id) or created_by = (select auth.uid()));

-- Histórico: lê quem vê o lead; usuário só cria anotação em nome próprio
create policy activities_select on public.activities for select to authenticated
  using (exists (select 1 from public.leads l where l.id = lead_id));
create policy activities_insert_note on public.activities for insert to authenticated
  with check (kind = 'note' and user_id = (select auth.uid())
              and exists (select 1 from public.leads l where l.id = lead_id));
create policy activities_delete on public.activities for delete to authenticated
  using (public.is_company_manager(company_id));

-- Conversas: mesma regra dos leads, usando assigned_to
create policy conversations_select on public.conversations for select to authenticated
  using (public.can_see_owned(company_id, assigned_to));
create policy conversations_update on public.conversations for update to authenticated
  using (public.can_see_owned(company_id, assigned_to))
  with check (public.is_company_manager(company_id) or assigned_to = (select auth.uid()));
create policy conversations_delete on public.conversations for delete to authenticated
  using (public.is_company_manager(company_id));
-- Inserção de conversas e de mensagens: só pelo servidor (webhook/envio com service_role)

-- Mensagens: só leitura para usuários, seguindo a visibilidade da conversa
create policy messages_select on public.messages for select to authenticated
  using (exists (select 1 from public.conversations c where c.id = conversation_id));

-- ---------------------------------------------------------------------
-- Storage: mídia do WhatsApp em bucket privado, sem acesso direto de usuário.
-- O app gera URL assinada no servidor depois de checar acesso à conversa.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('whatsapp-media', 'whatsapp-media', false)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------
alter publication supabase_realtime add table public.messages, public.conversations, public.leads, public.tasks;
