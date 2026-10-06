-- =====================================================================
-- Orvya — contratos de locação (Fase 2e)
-- "Em locação agora" (products.rented_count) passa a ser contado pelos
-- contratos ativos, em vez de digitado. Pode ser executado mais de uma vez.
-- =====================================================================

-- security definer: quem cria o contrato pode ser vendedor, que não altera produtos.
create or replace function public.refresh_rented_count()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_ids uuid[];
begin
  v_ids := array_remove(array[
    case when tg_op <> 'INSERT' then old.product_id end,
    case when tg_op <> 'DELETE' then new.product_id end
  ], null);

  update public.products p
  set rented_count = (
    select count(*) from public.rental_contracts c
    where c.product_id = p.id and c.status = 'ativo'
  )
  where p.id = any(v_ids);

  return null;
end $$;

drop trigger if exists rental_contracts_count on public.rental_contracts;
create trigger rental_contracts_count
  after insert or update of status, product_id or delete on public.rental_contracts
  for each row execute function public.refresh_rented_count();

-- Recalcula uma vez para o que já existe.
update public.products p
set rented_count = (select count(*) from public.rental_contracts c where c.product_id = p.id and c.status = 'ativo');
