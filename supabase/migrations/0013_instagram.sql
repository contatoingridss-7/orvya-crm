-- =====================================================================
-- Orvya — Instagram Direct.
--
-- Uma conta do Instagram (profissional, ligada à Página do Facebook) por empresa,
-- conectada pela API de Mensagens do Instagram (login do Facebook). O Direct entra na
-- mesma tela de Conversas (channel = 'instagram'), com lead, tarefas e alertas.
--
-- Respostas automáticas: boas-vindas, palavra-chave no Direct e comentário que vira
-- mensagem privada (uma por comentário, até 7 dias depois do comentário).
--
-- O token da Página fica em instagram_credentials, sem política (só o servidor lê).
-- As mensagens usam a mesma coluna de idempotência do WhatsApp (messages.wa_message_id),
-- que guarda o "mid" do Instagram.
-- Pode ser executado mais de uma vez.
-- =====================================================================

create table if not exists public.instagram_accounts (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null references public.companies (id) on delete cascade,
  ig_user_id           text not null unique,         -- IGID da conta profissional
  page_id              text not null,                -- Página do Facebook ligada
  username             text,
  name                 text,
  default_pipeline_id  uuid references public.pipelines (id) on delete set null,
  status               text not null default 'connected' check (status in ('connected', 'error', 'off')),
  last_error           text,
  connected_at         timestamptz not null default now(),
  created_at           timestamptz not null default now()
);
create index if not exists instagram_accounts_company_idx on public.instagram_accounts (company_id);

create table if not exists public.instagram_credentials (
  account_id         uuid primary key references public.instagram_accounts (id) on delete cascade,
  page_access_token  text not null,
  updated_at         timestamptz not null default now()
);

alter table public.conversations
  add column if not exists instagram_account_id uuid references public.instagram_accounts (id) on delete set null;

alter table public.contacts
  add column if not exists instagram_id        text,     -- IGSID (identificador do cliente para esta conta)
  add column if not exists instagram_username  text;
create unique index if not exists contacts_instagram_idx on public.contacts (company_id, instagram_id) where instagram_id is not null;

-- Respostas automáticas
create table if not exists public.ig_auto_replies (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  trigger     text not null check (trigger in ('welcome', 'dm_keyword', 'comment_keyword')),
  keywords    text[] not null default '{}',              -- em minúsculas, sem acento
  reply       text not null check (char_length(reply) between 1 and 900),
  position    int not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
create index if not exists ig_auto_replies_company_idx on public.ig_auto_replies (company_id, active);

-- Comentários já respondidos em privado (a Meta só permite uma resposta por comentário).
create table if not exists public.ig_comment_replies (
  comment_id  text primary key,
  company_id  uuid not null references public.companies (id) on delete cascade,
  rule_id     uuid references public.ig_auto_replies (id) on delete set null,
  username    text,
  comment     text,
  replied_at  timestamptz not null default now(),
  error       text
);

-- Menu de boas-vindas: primeira mensagem no Direct recebe as opções (botões de resposta
-- rápida, até 20 caracteres cada; "Outros" vai sempre por último). Qualquer opção
-- responde com o link do WhatsApp da empresa, com o assunto já escrito.
create table if not exists public.ig_welcome_menu (
  company_id          uuid primary key references public.companies (id) on delete cascade,
  enabled             boolean not null default true,
  intro               text not null check (char_length(intro) between 1 and 900),
  options             text[] not null default '{}' check (cardinality(options) between 0 and 12),
  link_reply          text not null check (char_length(link_reply) between 1 and 900),   -- {link} vira o link do WhatsApp
  whatsapp_number_id  uuid references public.whatsapp_numbers (id) on delete set null,      -- null = primeiro número brasileiro conectado
  updated_at          timestamptz not null default now()
);

alter table public.instagram_accounts    enable row level security;
alter table public.instagram_credentials enable row level security;
alter table public.ig_auto_replies       enable row level security;
alter table public.ig_comment_replies    enable row level security;

-- Conta: a equipe da empresa vê (nome e @); só o administrador conecta e desconecta.
drop policy if exists instagram_accounts_select on public.instagram_accounts;
create policy instagram_accounts_select on public.instagram_accounts for select to authenticated
  using (public.has_company_access(company_id));
drop policy if exists instagram_accounts_admin on public.instagram_accounts;
create policy instagram_accounts_admin on public.instagram_accounts for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

-- Respostas automáticas: gestor e admin editam; a equipe lê.
drop policy if exists ig_auto_replies_select on public.ig_auto_replies;
create policy ig_auto_replies_select on public.ig_auto_replies for select to authenticated
  using (public.has_company_access(company_id));
drop policy if exists ig_auto_replies_write on public.ig_auto_replies;
create policy ig_auto_replies_write on public.ig_auto_replies for all to authenticated
  using (public.is_company_manager(company_id)) with check (public.is_company_manager(company_id));

alter table public.ig_welcome_menu enable row level security;
drop policy if exists ig_welcome_menu_select on public.ig_welcome_menu;
create policy ig_welcome_menu_select on public.ig_welcome_menu for select to authenticated
  using (public.has_company_access(company_id));
drop policy if exists ig_welcome_menu_write on public.ig_welcome_menu;
create policy ig_welcome_menu_write on public.ig_welcome_menu for all to authenticated
  using (public.is_company_manager(company_id)) with check (public.is_company_manager(company_id));

drop policy if exists ig_comment_replies_select on public.ig_comment_replies;
create policy ig_comment_replies_select on public.ig_comment_replies for select to authenticated
  using (public.is_company_manager(company_id));

revoke all on public.instagram_credentials from anon, authenticated;

-- Origem "Instagram" para os leads que chegam pelo Direct (anúncios continuam "Meta Ads").
insert into public.lead_sources (company_id, name, position)
select c.id, 'Instagram Direct', 20
from public.companies c
where not exists (select 1 from public.lead_sources s where s.company_id = c.id and s.name = 'Instagram Direct');

-- Menu sugerido por empresa (editável em Automações).
insert into public.ig_welcome_menu (company_id, intro, options, link_reply)
select c.id,
       case c.slug
         when 'locpress' then 'Olá! Aqui é a LocPress Saúde. Sobre o que você quer falar? Toque em uma opção:'
         else 'Olá! Aqui é a IC Supra Hospitalar. Sobre o que você quer falar? Toque em uma opção:'
       end,
       case c.slug
         when 'locpress' then array['Locação equipamentos', 'CPAP e máscaras', 'Cama hospitalar', 'Home care']
         else array['Cadeira rodas/banho', 'Andador e muletas', 'Ortopédicos', 'CPAP e máscaras']
       end,
       'Para agilizar seu atendimento, nosso canal principal é o WhatsApp. Toque no link e fale direto com a nossa equipe: {link}'
from public.companies c
on conflict (company_id) do nothing;
