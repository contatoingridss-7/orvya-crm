-- =====================================================================
-- Orvya — Rodízio da LocPress com a Isabela Nascimento (pedido de 06/11/2026).
--
-- Isabela: segunda a sexta (8h às 18h) e sábado (9h às 13h), almoço 10h45 às 12h45,
-- recebe os leads do funil "CPAP e home care" (CPAP, ventilação domiciliar, oxigenoterapia,
-- concentrador de oxigênio). Palavras-chave levam o lead direto para esse funil.
-- Thays: continua com acesso à LocPress, mas fora do rodízio de lá (recebe pela IC).
-- Venda e Locação seguem sem rodízio: os leads ficam na fila para quem assumir.
-- Só dados de configuração (o mesmo que a tela de Distribuição de leads grava).
-- Pode ser executado mais de uma vez.
-- =====================================================================

with lp as (select id from public.companies where slug = 'locpress'),
     homecare as (select p.id from public.pipelines p join lp on p.company_id = lp.id where p.key = 'homecare'),
     isabela as (
       select m.user_id from public.memberships m join lp on m.company_id = lp.id
       join public.profiles pr on pr.id = m.user_id where pr.full_name ilike 'Isabela%' limit 1),
     thays as (
       select m.user_id from public.memberships m join lp on m.company_id = lp.id
       join public.profiles pr on pr.id = m.user_id where pr.full_name ilike 'Thays%' limit 1)
insert into public.lead_distribution (company_id, enabled, routes, work_days, breaks, rotation_pipelines, reassign_minutes, updated_at)
select lp.id, true,
       jsonb_build_array(jsonb_build_object(
         'pipeline_id', (select id from homecare),
         'keywords', jsonb_build_array('cpap', 'bipap', 'apneia', 'ronco', 'mascara de cpap', 'mascara nasal', 'mascara oronasal',
                                       'ventilacao', 'ventilador', 'oxigenio', 'oxigenoterapia', 'concentrador', 'cilindro de oxigenio', 'home care'))),
       jsonb_strip_nulls(jsonb_build_object(
         (select user_id::text from isabela), jsonb_build_array(1, 2, 3, 4, 5, 6),
         (select user_id::text from thays), '[]'::jsonb)),
       jsonb_build_object((select user_id::text from isabela), jsonb_build_array(jsonb_build_array('10:45', '12:45'))),
       jsonb_build_object((select user_id::text from isabela), jsonb_build_array((select id::text from homecare))),
       '{}'::jsonb,
       now()
from lp
where (select user_id from isabela) is not null
on conflict (company_id) do update set
  enabled = true,
  routes = excluded.routes,
  work_days = excluded.work_days,
  breaks = excluded.breaks,
  rotation_pipelines = excluded.rotation_pipelines,
  updated_at = now();
