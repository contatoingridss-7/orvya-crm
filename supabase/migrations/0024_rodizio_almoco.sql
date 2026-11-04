-- =====================================================================
-- Orvya — Rodízio: intervalo de almoço e funis em que cada vendedor recebe leads.
--
-- - breaks: {"<user_id>": [["12:00", "13:00"]]} — no intervalo o vendedor sai do rodízio e o
--   lead novo vai para quem está disponível (ex.: Renato 12h–13h, Gabriel 13h–14h).
-- - rotation_pipelines: {"<user_id>": ["<pipeline_id>", ...]} — funis em que o vendedor RECEBE
--   leads pelo rodízio. Ausente = os funis que ele enxerga (memberships.pipeline_ids).
--   Ex.: a Thays enxerga todos os funis, mas só recebe pelo rodízio os leads do CPAP.
-- - O lead que ficou sem ninguém disponível é distribuído pela rotina a cada 15 minutos no horário.
-- Pode ser executado mais de uma vez.
-- =====================================================================

alter table public.lead_distribution
  add column if not exists breaks jsonb not null default '{}'::jsonb,
  add column if not exists rotation_pipelines jsonb not null default '{}'::jsonb;

create or replace function public.rotation_next(p_pipeline uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid;
  v_last    uuid;
  v_next    uuid;
  v_days    jsonb;
  v_breaks  jsonb;
  v_rot     jsonb;
  v_today   int := extract(isodow from now() at time zone 'America/Fortaleza')::int;
  v_time    text := to_char(now() at time zone 'America/Fortaleza', 'HH24:MI');
begin
  select company_id into v_company from public.pipelines where id = p_pipeline;
  if v_company is null then return null; end if;
  select work_days, breaks, rotation_pipelines into v_days, v_breaks, v_rot from public.lead_distribution where company_id = v_company;
  insert into public.lead_rotation (pipeline_id) values (p_pipeline) on conflict (pipeline_id) do nothing;
  select last_user_id into v_last from public.lead_rotation where pipeline_id = p_pipeline for update;

  with ordered as (
    select m.user_id, row_number() over (order by lower(coalesce(p.full_name, p.email, '')), m.user_id) as rn
    from public.memberships m
    join public.profiles p on p.id = m.user_id
    where m.company_id = v_company
      and m.role = 'vendedor'
      and p.active
      and (m.pipeline_ids is null or cardinality(m.pipeline_ids) = 0 or p_pipeline = any (m.pipeline_ids))
      -- Funis do rodízio de cada vendedor (quando definidos).
      and (v_rot is null or not (v_rot ? m.user_id::text) or (v_rot -> m.user_id::text) @> to_jsonb(p_pipeline::text))
      -- Só quem trabalha hoje (ex.: sábado só a equipe do CPAP).
      and (v_days is null or not (v_days ? m.user_id::text) or (v_days -> m.user_id::text) @> to_jsonb(v_today))
      -- Fora do intervalo de almoço.
      and not exists (
        select 1 from jsonb_array_elements(coalesce(v_breaks -> m.user_id::text, '[]'::jsonb)) b
        where v_time >= (b ->> 0) and v_time < (b ->> 1)
      )
  )
  select o.user_id into v_next
  from ordered o
  order by (o.rn <= coalesce((select rn from ordered where user_id = v_last), 0)), o.rn
  limit 1;

  if v_next is not null then
    update public.lead_rotation set last_user_id = v_next, updated_at = now() where pipeline_id = p_pipeline;
  end if;
  return v_next;
end $$;

revoke execute on function public.rotation_next(uuid) from public, anon, authenticated;
