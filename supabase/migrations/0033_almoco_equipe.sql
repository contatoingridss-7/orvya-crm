-- =====================================================================
-- Orvya — Horário de almoço da equipe no rodízio (pedido de 06/11/2026).
--
-- No almoço o vendedor sai do rodízio e o lead novo vai para quem está disponível.
-- LocPress: Deusdeth 13h às 15h (segunda a sábado); Isabela 10h45 às 12h45 (já gravado na 0032).
-- IC Supra: Renato 12h às 13h; Gabriel e Gilcélia 13h às 14h.
-- Só acrescenta/atualiza o almoço dessas pessoas; o resto da distribuição fica como está.
-- Pode ser executado mais de uma vez.
-- =====================================================================

with people as (
  select c.id as company_id, m.user_id, b.lunch
  from (values
    ('locpress', 'Deusdeth%', '["13:00","15:00"]'),
    ('locpress', 'Isabela%',  '["10:45","12:45"]'),
    ('ic-supra', 'Renato%',   '["12:00","13:00"]'),
    ('ic-supra', 'Gabriel%',  '["13:00","14:00"]'),
    ('ic-supra', 'Gilc%',     '["13:00","14:00"]')
  ) as b(slug, name_like, lunch)
  join public.companies c on c.slug = b.slug
  join public.memberships m on m.company_id = c.id and m.role = 'vendedor'
  join public.profiles p on p.id = m.user_id and p.full_name ilike b.name_like
),
merged as (
  select company_id, jsonb_object_agg(user_id::text, jsonb_build_array(lunch::jsonb)) as breaks
  from people group by company_id
)
update public.lead_distribution d
set breaks = coalesce(d.breaks, '{}'::jsonb) || merged.breaks,
    updated_at = now()
from merged
where d.company_id = merged.company_id;

-- Deusdeth trabalha de segunda a sábado.
update public.lead_distribution d
set work_days = coalesce(d.work_days, '{}'::jsonb) || jsonb_build_object(m.user_id::text, jsonb_build_array(1, 2, 3, 4, 5, 6))
from public.memberships m
join public.profiles p on p.id = m.user_id and p.full_name ilike 'Deusdeth%'
join public.companies c on c.id = m.company_id and c.slug = 'locpress'
where d.company_id = c.id;
