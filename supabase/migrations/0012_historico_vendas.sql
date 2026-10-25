-- =====================================================================
-- Orvya — histórico de vendas importado do Net Use.
--
-- Cada relatório importado ("Movimento Sintético de Vendas" ou "Acompanhamento de
-- Vendas e Serviços") vira um período salvo, que nunca é substituído por outro
-- período. Reimportar o MESMO período substitui só aquele período.
--
-- Visibilidade (decisão da gestão):
--   gestor e admin: quantidades e valores (R$);
--   vendedor: só quantidades (as funções abaixo devolvem o valor vazio para ele).
-- As tabelas só são lidas diretamente por gestor/admin; o vendedor lê pelas funções.
-- Pode ser executado mais de uma vez.
-- =====================================================================

create table if not exists public.sales_reports (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete cascade,
  kind          text not null check (kind in ('vendas', 'servicos')),
  period_start  date not null,
  period_end    date not null check (period_end >= period_start),
  item_count    int not null default 0,
  total_qty     numeric(14, 2) not null default 0,
  total_value   numeric(14, 2) not null default 0,
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  unique (company_id, kind, period_start, period_end)
);
create index if not exists sales_reports_company_idx on public.sales_reports (company_id, period_end desc);

create table if not exists public.sales_report_items (
  id          bigint generated always as identity primary key,
  report_id   uuid not null references public.sales_reports (id) on delete cascade,
  company_id  uuid not null references public.companies (id) on delete cascade,
  product_id  uuid references public.products (id) on delete set null,
  code        text,
  name        text not null,
  unit        text,
  qty         numeric(14, 2) not null default 0,
  total       numeric(14, 2) not null default 0,
  is_rental   boolean not null default false
);
create index if not exists sales_report_items_report_idx on public.sales_report_items (report_id);
create index if not exists sales_report_items_product_idx on public.sales_report_items (company_id, product_id);

alter table public.sales_reports enable row level security;
alter table public.sales_report_items enable row level security;

drop policy if exists sales_reports_manager on public.sales_reports;
create policy sales_reports_manager on public.sales_reports for all to authenticated
  using (public.is_company_manager(company_id)) with check (public.is_company_manager(company_id));
drop policy if exists sales_report_items_manager on public.sales_report_items;
create policy sales_report_items_manager on public.sales_report_items for all to authenticated
  using (public.is_company_manager(company_id)) with check (public.is_company_manager(company_id));

-- Grava um relatório: substitui só o mesmo período (mesma empresa, tipo e datas).
-- p_items: [{ "code", "name", "unit", "qty", "total", "is_rental" }]
create or replace function public.save_sales_report(p_company uuid, p_kind text, p_start date, p_end date, p_items jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if not public.is_company_manager(p_company) then
    raise exception 'Só gestor ou administrador importa vendas';
  end if;
  if p_kind not in ('vendas', 'servicos') then raise exception 'Tipo inválido'; end if;
  if p_end < p_start then raise exception 'Período inválido'; end if;

  delete from public.sales_reports where company_id = p_company and kind = p_kind and period_start = p_start and period_end = p_end;

  insert into public.sales_reports (company_id, kind, period_start, period_end, created_by)
  values (p_company, p_kind, p_start, p_end, (select auth.uid()))
  returning id into v_id;

  insert into public.sales_report_items (report_id, company_id, product_id, code, name, unit, qty, total, is_rental)
  select v_id, p_company,
         (select pr.id from public.products pr
          where pr.company_id = p_company and nullif(btrim(i->>'code'), '') is not null and pr.code = btrim(i->>'code') limit 1),
         nullif(btrim(i->>'code'), ''), btrim(i->>'name'), nullif(i->>'unit', ''),
         coalesce((i->>'qty')::numeric, 0), coalesce((i->>'total')::numeric, 0), coalesce((i->>'is_rental')::boolean, false)
  from jsonb_array_elements(p_items) i
  where nullif(btrim(i->>'name'), '') is not null;

  update public.sales_reports r
  set item_count = s.n, total_qty = s.q, total_value = s.v
  from (select count(*) n, coalesce(sum(qty), 0) q, coalesce(sum(total), 0) v from public.sales_report_items where report_id = v_id) s
  where r.id = v_id;

  return v_id;
end $$;

-- Períodos importados (todos os perfis comerciais veem as datas; valor só gestor/admin).
create or replace function public.sales_periods(p_company uuid)
returns table (id uuid, kind text, period_start date, period_end date, item_count int, total_qty numeric, total_value numeric, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare v_manager boolean := public.is_company_manager(p_company);
begin
  if not public.has_company_access(p_company) then raise exception 'Sem acesso'; end if;
  return query
  select r.id, r.kind, r.period_start, r.period_end, r.item_count, r.total_qty,
         case when v_manager then r.total_value end, r.created_at
  from public.sales_reports r
  where r.company_id = p_company
  order by r.period_end desc, r.kind;
end $$;

-- Vendas por produto nos relatórios escolhidos (valor só para gestor/admin).
create or replace function public.sales_by_product(p_company uuid, p_reports uuid[])
returns table (product_id uuid, code text, name text, unit text, is_rental boolean, qty numeric, total numeric)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare v_manager boolean := public.is_company_manager(p_company);
begin
  if not public.has_company_access(p_company) then raise exception 'Sem acesso'; end if;
  return query
  select (array_agg(i.product_id) filter (where i.product_id is not null))[1],
         i.code, max(i.name), max(i.unit), bool_or(i.is_rental),
         sum(i.qty), case when v_manager then sum(i.total) end
  from public.sales_report_items i
  join public.sales_reports r on r.id = i.report_id
  where i.company_id = p_company and r.company_id = p_company and r.id = any (p_reports)
  group by i.code, case when i.code is null then i.name end
  order by sum(i.qty) desc;
end $$;

-- Média mensal de unidades vendidas por produto (últimos 180 dias de relatórios),
-- para o Catálogo: "vende cerca de X por mês". Só quantidades: vale para todos.
create or replace function public.product_monthly_sales(p_company uuid)
returns table (product_id uuid, per_month numeric)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare v_days numeric;
begin
  if not (public.has_company_access(p_company) or public.is_logistics(p_company)) then raise exception 'Sem acesso'; end if;
  -- Dias cobertos pelos relatórios recentes (sem contar duas vezes o mesmo período de vendas e serviços).
  select coalesce(sum(d), 0) into v_days from (
    select distinct on (period_start, period_end) (period_end - period_start + 1) d
    from public.sales_reports where company_id = p_company and period_end >= current_date - 180
  ) x;
  if v_days = 0 then return; end if;
  return query
  select i.product_id, round(sum(i.qty) / (v_days / 30.0), 1)
  from public.sales_report_items i
  join public.sales_reports r on r.id = i.report_id
  where i.company_id = p_company and i.product_id is not null and r.period_end >= current_date - 180
  group by i.product_id;
end $$;

revoke all on function public.save_sales_report(uuid, text, date, date, jsonb) from public, anon;
revoke all on function public.sales_periods(uuid) from public, anon;
revoke all on function public.sales_by_product(uuid, uuid[]) from public, anon;
revoke all on function public.product_monthly_sales(uuid) from public, anon;
grant execute on function public.save_sales_report(uuid, text, date, date, jsonb) to authenticated;
grant execute on function public.sales_periods(uuid) to authenticated;
grant execute on function public.sales_by_product(uuid, uuid[]) to authenticated;
grant execute on function public.product_monthly_sales(uuid) to authenticated;
