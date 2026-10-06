-- =====================================================================
-- Orvya — catálogo (Fase 2a)
-- Importação dos relatórios do Net Use e planilhas, preço de referência
-- e itens cujo valor é sempre negociado pela equipe (locação).
-- =====================================================================

-- Pode ser executado mais de uma vez sem erro.
alter table public.products
  add column if not exists unit             text,
  -- Preço médio praticado, calculado dos relatórios de vendas. Só orienta o gestor:
  -- a IA usa apenas sale_price (confirmado).
  add column if not exists reference_price  numeric(12, 2),
  add column if not exists reference_qty    numeric(12, 2),        -- quantas unidades entraram na média
  add column if not exists reference_note   text,                  -- ex.: "Média de 01/08 a 30/09/2026"
  -- Item de locação (a LocPress negocia o valor caso a caso).
  add column if not exists is_rental        boolean not null default false,
  -- Valor sempre negociado por uma pessoa: a IA coleta os dados e passa para a equipe.
  add column if not exists requires_human   boolean not null default false,
  add column if not exists stock_updated_at timestamptz,
  add column if not exists source           text not null default 'manual' check (source in ('manual', 'netuse', 'planilha'));

-- O código do Net Use identifica o produto nas importações seguintes.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'products_company_code_key') then
    alter table public.products add constraint products_company_code_key unique (company_id, code);
  end if;
end $$;

-- Os 16 itens iniciais da IC Supra tinham códigos e nomes divergentes do Net Use;
-- o catálogo passa a vir da importação. (Nenhum lead aponta para eles ainda.)
-- Só os 16 do seed (pelo código), para não apagar nada cadastrado depois se o script rodar de novo.
delete from public.products
where company_id = (select id from public.companies where slug = 'ic-supra')
  and source = 'manual'
  and sale_price is null
  and reference_price is null
  and code in ('414', '417', '80', '6407', '7319', '8104', '9866', '7367', '8094', '7682', '7683', '3319', '9897', '8029', '8030', '9924');

-- ---------------------------------------------------------------------
-- Importação em lote
-- Roda com as permissões de quem chamou (security invoker): o RLS de products
-- já exige gestor/admin para inserir e alterar.
--
-- Cada linha de p_rows pode trazer só parte dos campos. Campo ausente (null)
-- = manter o valor atual. clear_sale_price = true deixa o item "sob consulta".
-- Linhas sem code são casadas pelo nome (planilha da LocPress).
-- ---------------------------------------------------------------------
create or replace function public.import_products(p_company uuid, p_rows jsonb, p_deactivate uuid[] default '{}')
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_updated int;
  v_inserted int;
  v_deactivated int;
begin
  if not public.is_company_manager(p_company) then
    raise exception 'Sem permissão para alterar o catálogo desta empresa';
  end if;

  with rows as (
    select *
    from jsonb_to_recordset(p_rows) as r(
      code text, name text, unit text, category text, stock int,
      sale_price numeric, clear_sale_price boolean, rent_price_month numeric,
      is_rental boolean, requires_human boolean,
      reference_price numeric, reference_qty numeric, reference_note text,
      ai_notes text, active boolean, source text
    )
  ),
  matched as (
    select r.*, p.id as product_id
    from rows r
    left join lateral (
      select pr.id
      from public.products pr
      where pr.company_id = p_company
        and ((nullif(btrim(r.code), '') is not null and pr.code = btrim(r.code))
          or (nullif(btrim(r.code), '') is null and lower(pr.name) = lower(btrim(r.name))))
      limit 1
    ) p on true
  ),
  upd as (
    update public.products pr set
      name             = coalesce(nullif(btrim(m.name), ''), pr.name),
      unit             = coalesce(m.unit, pr.unit),
      category         = coalesce(m.category, pr.category),
      stock            = coalesce(m.stock, pr.stock),
      stock_updated_at = case when m.stock is not null then now() else pr.stock_updated_at end,
      sale_price       = case when coalesce(m.clear_sale_price, false) then null else coalesce(m.sale_price, pr.sale_price) end,
      rent_price_month = coalesce(m.rent_price_month, pr.rent_price_month),
      is_rental        = coalesce(m.is_rental, pr.is_rental),
      requires_human   = coalesce(m.requires_human, pr.requires_human),
      reference_price  = coalesce(m.reference_price, pr.reference_price),
      reference_qty    = coalesce(m.reference_qty, pr.reference_qty),
      reference_note   = coalesce(m.reference_note, pr.reference_note),
      ai_notes         = coalesce(m.ai_notes, pr.ai_notes),
      active           = coalesce(m.active, pr.active)
    from matched m
    where m.product_id = pr.id
    returning 1
  ),
  ins as (
    insert into public.products (
      company_id, code, name, unit, category, stock, stock_updated_at,
      sale_price, rent_price_month, is_rental, requires_human,
      reference_price, reference_qty, reference_note, ai_notes, active, source
    )
    select
      p_company, nullif(btrim(m.code), ''), btrim(m.name), m.unit, m.category,
      coalesce(m.stock, 0), case when m.stock is not null then now() end,
      case when coalesce(m.clear_sale_price, false) then null else m.sale_price end,
      m.rent_price_month, coalesce(m.is_rental, false), coalesce(m.requires_human, m.is_rental, false),
      m.reference_price, m.reference_qty, m.reference_note, m.ai_notes,
      coalesce(m.active, true), coalesce(m.source, 'manual')
    from matched m
    where m.product_id is null and nullif(btrim(m.name), '') is not null
    returning 1
  )
  select (select count(*) from upd), (select count(*) from ins) into v_updated, v_inserted;

  update public.products
  set active = false
  where company_id = p_company and id = any(p_deactivate) and active;
  get diagnostics v_deactivated = row_count;

  return jsonb_build_object('updated', v_updated, 'inserted', v_inserted, 'deactivated', v_deactivated);
end $$;

-- Usa o preço de referência como preço de venda confirmado (só onde ainda não há preço).
create or replace function public.confirm_reference_prices(p_company uuid, p_ids uuid[])
returns int
language plpgsql
security invoker
set search_path = ''
as $$
declare v_count int;
begin
  if not public.is_company_manager(p_company) then
    raise exception 'Sem permissão para alterar o catálogo desta empresa';
  end if;
  update public.products
  set sale_price = reference_price
  where company_id = p_company and id = any(p_ids)
    and reference_price is not null and sale_price is null and not requires_human;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

grant execute on function public.import_products(uuid, jsonb, uuid[]) to authenticated;
grant execute on function public.confirm_reference_prices(uuid, uuid[]) to authenticated;
