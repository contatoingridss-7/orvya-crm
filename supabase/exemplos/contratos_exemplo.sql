-- =====================================================================
-- Orvya — contrato de locação de EXEMPLO (rodar depois de leads_exemplo.sql
-- e da migration 0005). Usa a lead de exemplo Carla Mendes (LocPress · Em locação):
-- contrato de 3 meses que vence em 9 dias, para aparecer no Painel e no card.
-- É apagado junto com os leads de exemplo (remover_exemplos.sql).
-- =====================================================================
insert into public.rental_contracts (company_id, lead_id, product_id, serial_number, start_date, end_date, monthly_value, delivery_address, status)
select l.company_id, l.id,
       (select p.id from public.products p where p.company_id = l.company_id and p.code = '289'),
       'CE-EXEMPLO-01',
       current_date - 82, current_date + 9, 420,
       'Rua Exemplo, 200 — Bairro Exemplo, Teresina', 'ativo'
from public.leads l
join public.contacts c on c.id = l.contact_id
where c.notes = 'Exemplo Orvya — pode apagar' and c.name = 'Carla Mendes'
  and not exists (select 1 from public.rental_contracts r where r.lead_id = l.id);
