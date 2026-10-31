-- =====================================================================
-- Orvya — Respostas rápidas ("/" na conversa) e materiais para enviar (PDFs).
--
-- - quick_replies: atalho + texto, por empresa. A equipe usa na conversa digitando "/";
--   as mais usadas aparecem primeiro (uses, somado por quick_reply_used).
-- - sales_materials: catálogos, tabelas e folhetos (PDF ou imagem) no bucket privado
--   sales-materials/{company_id}/... O servidor gera um link temporário e envia como
--   documento do WhatsApp (só dentro da janela de 24 h).
-- Gestor e admin cadastram; toda a equipe da empresa usa.
-- Pode ser executado mais de uma vez.
-- =====================================================================

create table if not exists public.quick_replies (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  shortcut    text not null check (shortcut ~ '^[a-z0-9-]{2,30}$'),     -- digitado depois da "/"
  body        text not null check (char_length(body) between 1 and 2000), -- {nome} e {vendedor} são trocados no envio
  uses        int not null default 0,
  created_at  timestamptz not null default now(),
  unique (company_id, shortcut)
);

create table if not exists public.sales_materials (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  title       text not null check (char_length(title) between 1 and 120),
  file_path   text not null unique,     -- {company_id}/{uuid}.pdf no bucket sales-materials
  file_name   text not null,            -- nome que o cliente vê no WhatsApp
  mime        text not null,
  size_bytes  int not null default 0,
  uses        int not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists sales_materials_company_idx on public.sales_materials (company_id, title);

alter table public.quick_replies   enable row level security;
alter table public.sales_materials enable row level security;

drop policy if exists quick_replies_select on public.quick_replies;
create policy quick_replies_select on public.quick_replies for select to authenticated
  using (public.has_company_access(company_id));
drop policy if exists quick_replies_write on public.quick_replies;
create policy quick_replies_write on public.quick_replies for all to authenticated
  using (public.is_company_manager(company_id)) with check (public.is_company_manager(company_id));

drop policy if exists sales_materials_select on public.sales_materials;
create policy sales_materials_select on public.sales_materials for select to authenticated
  using (public.has_company_access(company_id));
drop policy if exists sales_materials_write on public.sales_materials;
create policy sales_materials_write on public.sales_materials for all to authenticated
  using (public.is_company_manager(company_id)) with check (public.is_company_manager(company_id));

-- Quem usa uma resposta rápida soma 1 (a lista ordena pelas mais usadas).
create or replace function public.quick_reply_used(p_id uuid)
returns void language sql security definer set search_path = '' as $$
  update public.quick_replies set uses = uses + 1
  where id = p_id and public.has_company_access(company_id);
$$;
revoke execute on function public.quick_reply_used(uuid) from public, anon;
grant execute on function public.quick_reply_used(uuid) to authenticated;

-- Bucket privado dos materiais: gestor e admin enviam na pasta da empresa; o envio ao cliente
-- usa link assinado gerado no servidor.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('sales-materials', 'sales-materials', false, 16777216, array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do update set public = false, file_size_limit = 16777216, allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png'];

create or replace function public.can_manage_materials(p_folder text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.companies co where co.id::text = p_folder and public.is_company_manager(co.id));
$$;
revoke execute on function public.can_manage_materials(text) from public, anon;
grant execute on function public.can_manage_materials(text) to authenticated;

drop policy if exists sales_materials_files_insert on storage.objects;
create policy sales_materials_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'sales-materials' and public.can_manage_materials((storage.foldername(name))[1]));
drop policy if exists sales_materials_files_delete on storage.objects;
create policy sales_materials_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'sales-materials' and public.can_manage_materials((storage.foldername(name))[1]));

-- Respostas iniciais (a gestão edita em Automações).
insert into public.quick_replies (company_id, shortcut, body)
select c.id, r.shortcut, r.body
from public.companies c
cross join (values
  ('horario', 'Nosso atendimento é de segunda a sexta, das 8h às 18h, e aos sábados, das 8h às 11h.'),
  ('pagamento', 'Não trabalhamos com link de pagamento. O cartão na entrega é aceito a partir de um valor mínimo de compra; te passo as opções para o seu pedido.'),
  ('endereco', 'Para eu calcular a entrega, me passa o endereço completo com bairro e um ponto de referência?'),
  ('retorno', 'Oi, {nome}! Passando para saber se ficou alguma dúvida sobre o orçamento. Posso te ajudar a fechar?'),
  ('obrigado', 'Obrigado pela preferência, {nome}! Qualquer coisa, é só chamar aqui. {vendedor}')
) as r(shortcut, body)
on conflict (company_id, shortcut) do nothing;
