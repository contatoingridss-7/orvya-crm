-- =====================================================================
-- Orvya — Fotos do catálogo também pelos vendedores (pedido de 04/11/2026).
--
-- Antes: só gestor, admin e expedição incluíam e trocavam a foto do produto.
-- Agora: qualquer pessoa da equipe da empresa (vendedor incluído). Preço, estoque e o
-- restante do produto continuam só com gestor e admin.
-- Pode ser executado mais de uma vez.
-- =====================================================================

-- Pasta da empresa no bucket product-photos: quem tem acesso à empresa pode enviar/trocar.
create or replace function public.can_manage_product_photos(p_folder text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.companies co
    where co.id::text = p_folder
      and (public.is_company_manager(co.id) or public.is_logistics(co.id) or public.has_company_access(co.id)));
$$;

-- Grava a foto no produto (só a foto; o resto do produto continua protegido pelo RLS).
create or replace function public.set_product_photo(p_product uuid, p_path text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_company uuid;
begin
  select company_id into v_company from public.products where id = p_product;
  if v_company is null then raise exception 'Produto não encontrado'; end if;
  if not (public.is_company_manager(v_company) or public.is_logistics(v_company) or public.has_company_access(v_company)) then
    raise exception 'Sem permissão para alterar a foto';
  end if;
  if p_path is not null and p_path not like v_company::text || '/%' then
    raise exception 'Caminho de foto inválido';
  end if;
  update public.products set photo_path = p_path where id = p_product;
end $$;
