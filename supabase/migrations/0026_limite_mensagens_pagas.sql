-- =====================================================================
-- Orvya — Limite mensal de mensagens pagas do WhatsApp (pedido de 04/11/2026).
--
-- Modelo enviado para quem não escreveu nas últimas 24 h é cobrado pela Meta no cartão
-- da empresa. O gestor define quantos modelos a equipe pode enviar por mês; passou do
-- limite, o vendedor usa o link grátis e só gestor/admin seguem enviando modelos.
-- Sem linha = sem limite. Mês no fuso de Teresina (America/Fortaleza).
-- Pode ser executado mais de uma vez.
-- =====================================================================

create table if not exists public.whatsapp_paid_budget (
  company_id     uuid primary key references public.companies (id) on delete cascade,
  monthly_limit  integer not null check (monthly_limit between 0 and 100000),
  updated_at     timestamptz not null default now()
);

alter table public.whatsapp_paid_budget enable row level security;
drop policy if exists whatsapp_paid_budget_select on public.whatsapp_paid_budget;
create policy whatsapp_paid_budget_select on public.whatsapp_paid_budget for select to authenticated
  using (public.has_company_access(company_id));
drop policy if exists whatsapp_paid_budget_write on public.whatsapp_paid_budget;
create policy whatsapp_paid_budget_write on public.whatsapp_paid_budget for all to authenticated
  using (public.can_configure(company_id)) with check (public.can_configure(company_id));

-- Modelos enviados no mês pela empresa (o vendedor só enxerga as conversas dele pelo RLS,
-- mas o limite é da empresa toda; por isso a contagem roda aqui, só para quem tem acesso).
create or replace function public.paid_messages_this_month(p_company uuid)
returns integer language sql stable security definer set search_path = '' as $$
  select case when public.has_company_access(p_company) then (
    select count(*)::int from public.messages m
    where m.company_id = p_company
      and m.direction = 'out'
      and m.msg_type = 'template'
      and m.created_at >= (date_trunc('month', now() at time zone 'America/Fortaleza') at time zone 'America/Fortaleza'))
  else 0 end;
$$;
grant execute on function public.paid_messages_this_month(uuid) to authenticated;

-- Ponto de partida combinado: 30 mensagens pagas por mês em cada empresa (≈ R$ 10,50 em marketing).
insert into public.whatsapp_paid_budget (company_id, monthly_limit)
select id, 30 from public.companies
on conflict (company_id) do nothing;
