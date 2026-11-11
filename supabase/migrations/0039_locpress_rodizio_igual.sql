-- =====================================================================
-- Orvya — LocPress: rodízio igual para todos, em todos os funis (pedido de 09/11/2026).
--
-- Antes (0034): ordem de prioridade (CPAP: Isabela → Thays; Venda/Locação: Deusdeth → Isabela → Thays).
-- Agora: não há especialista de CPAP na LocPress. Thays, Isabela e Deusdeth recebem um lead cada,
-- em sequência, em Venda, Locação e CPAP e home care. Repasse de 10 min e almoços continuam.
-- Pode ser executado mais de uma vez.
-- =====================================================================

with lp as (select id from public.companies where slug = 'locpress'),
     team as (
       select m.user_id from public.memberships m join lp on m.company_id = lp.id
       join public.profiles p on p.id = m.user_id
       where m.role = 'vendedor' and p.active
     )
update public.lead_distribution d
set enabled = true,
    priority = '{}'::jsonb,                 -- sem ordem de prioridade: rodízio
    rotation_pipelines = '{}'::jsonb,       -- todos recebem de todos os funis
    work_days = coalesce(d.work_days, '{}'::jsonb)
      || coalesce((select jsonb_object_agg(user_id::text, jsonb_build_array(1, 2, 3, 4, 5, 6)) from team), '{}'::jsonb),
    updated_at = now()
from lp
where d.company_id = lp.id;
