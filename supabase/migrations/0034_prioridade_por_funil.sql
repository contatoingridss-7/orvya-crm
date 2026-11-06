-- =====================================================================
-- Orvya — Ordem de prioridade por funil (pedido de 06/11/2026).
--
-- lead_distribution.priority: {"<pipeline_id>": ["<user_id>", ...]}. Funil com ordem definida
-- não usa o rodízio: o lead novo vai para o PRIMEIRO da lista que está disponível (dia de
-- trabalho, fora do almoço, ativo e com acesso ao funil); o repasse por falta de resposta
-- (reassign_minutes, 0028) passa para o PRÓXIMO da lista. Funil sem ordem continua no rodízio.
--
-- LocPress (pedido da gestão):
--   CPAP e home care: Isabela → Thays (Isabela repassa após 20 min sem resposta)
--   Venda e Locação:  Deusdeth → Isabela → Thays
-- E a triagem com botões no primeiro contato também na LocPress.
-- Pode ser executado mais de uma vez.
-- =====================================================================

alter table public.lead_distribution
  add column if not exists priority jsonb not null default '{}'::jsonb;

-- Vendedor pode receber agora neste funil? (ativo, vê o funil, trabalha hoje, fora do almoço)
create or replace function public.seller_available(p_company uuid, p_user uuid, p_pipeline uuid)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  v_days   jsonb;
  v_breaks jsonb;
  v_today  int := extract(isodow from now() at time zone 'America/Fortaleza')::int;
  v_time   text := to_char(now() at time zone 'America/Fortaleza', 'HH24:MI');
begin
  select work_days, breaks into v_days, v_breaks from public.lead_distribution where company_id = p_company;
  return exists (
    select 1 from public.memberships m
    join public.profiles p on p.id = m.user_id
    where m.company_id = p_company and m.user_id = p_user and m.role = 'vendedor' and p.active
      and (m.pipeline_ids is null or cardinality(m.pipeline_ids) = 0 or p_pipeline = any (m.pipeline_ids))
      and (v_days is null or not (v_days ? p_user::text) or (v_days -> p_user::text) @> to_jsonb(v_today))
      and not exists (
        select 1 from jsonb_array_elements(coalesce(v_breaks -> p_user::text, '[]'::jsonb)) b
        where v_time >= (b ->> 0) and v_time < (b ->> 1)
      )
  );
end $$;
revoke execute on function public.seller_available(uuid, uuid, uuid) from public, anon, authenticated;

-- Próximo da ordem de prioridade depois de p_after (null = do começo). Null se ninguém disponível.
create or replace function public.priority_next(p_pipeline uuid, p_after uuid default null)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare
  v_company uuid;
  v_list    jsonb;
  v_pos     bigint;
  v_next    uuid;
begin
  select company_id into v_company from public.pipelines where id = p_pipeline;
  select priority -> p_pipeline::text into v_list from public.lead_distribution where company_id = v_company;
  if v_list is null or jsonb_typeof(v_list) <> 'array' or jsonb_array_length(v_list) = 0 then return null; end if;
  select e.ord into v_pos from jsonb_array_elements_text(v_list) with ordinality e(uid, ord) where e.uid = p_after::text;
  select e.uid::uuid into v_next
  from jsonb_array_elements_text(v_list) with ordinality e(uid, ord)
  where e.ord > coalesce(v_pos, 0)
    and e.uid <> coalesce(p_after::text, '')
    and public.seller_available(v_company, e.uid::uuid, p_pipeline)
  order by e.ord
  limit 1;
  return v_next;
end $$;
revoke execute on function public.priority_next(uuid, uuid) from public, anon, authenticated;

-- Rodízio (0024) com a ordem de prioridade na frente quando o funil tem uma.
create or replace function public.rotation_next(p_pipeline uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid;
  v_last    uuid;
  v_next    uuid;
  v_days    jsonb;
  v_breaks  jsonb;
  v_rot     jsonb;
  v_prio    jsonb;
  v_today   int := extract(isodow from now() at time zone 'America/Fortaleza')::int;
  v_time    text := to_char(now() at time zone 'America/Fortaleza', 'HH24:MI');
begin
  select company_id into v_company from public.pipelines where id = p_pipeline;
  if v_company is null then return null; end if;
  select work_days, breaks, rotation_pipelines, priority -> p_pipeline::text
    into v_days, v_breaks, v_rot, v_prio
  from public.lead_distribution where company_id = v_company;

  if v_prio is not null and jsonb_typeof(v_prio) = 'array' and jsonb_array_length(v_prio) > 0 then
    return public.priority_next(p_pipeline, null);
  end if;

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
      and (v_rot is null or not (v_rot ? m.user_id::text) or (v_rot -> m.user_id::text) @> to_jsonb(p_pipeline::text))
      and (v_days is null or not (v_days ? m.user_id::text) or (v_days -> m.user_id::text) @> to_jsonb(v_today))
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

-- Repasse sem resposta (0028): com ordem de prioridade, vai para o próximo da lista.
create or replace function public.reassign_unanswered()
returns int language plpgsql security definer set search_path = '' as $$
declare
  r       record;
  v_new   uuid;
  v_try   int;
  v_count int := 0;
  v_from  text;
  v_to    text;
begin
  for r in
    select l.id as lead_id, l.company_id, l.pipeline_id, l.owner_id, c.id as conv_id,
           (d.reassign_minutes ->> l.owner_id::text)::int as mins,
           (d.priority ? l.pipeline_id::text) as has_priority
    from public.leads l
    join public.lead_distribution d on d.company_id = l.company_id and d.enabled
    join public.conversations c on c.lead_id = l.id and c.assigned_to = l.owner_id
    where l.closed_at is null
      and l.owner_id is not null
      and d.reassign_minutes ? l.owner_id::text
      and c.last_inbound_at is not null
      and l.created_at > now() - interval '3 days'
      and public.company_is_open(l.company_id)
      and greatest(
            c.last_inbound_at,
            coalesce((select max(a.created_at) from public.activities a where a.lead_id = l.id and a.kind = 'assignment'), l.created_at)
          ) < now() - make_interval(mins => (d.reassign_minutes ->> l.owner_id::text)::int)
      and not exists (
        select 1 from public.messages m
        where m.conversation_id = c.id and m.direction = 'out' and m.sender = 'user' and m.created_at >= l.created_at
      )
  loop
    v_new := null;
    if r.has_priority then
      v_new := public.priority_next(r.pipeline_id, r.owner_id);
    else
      for v_try in 1..8 loop
        v_new := public.rotation_next(r.pipeline_id);
        exit when v_new is null or v_new <> r.owner_id;
      end loop;
    end if;
    continue when v_new is null or v_new = r.owner_id;

    update public.leads set owner_id = v_new where id = r.lead_id;
    update public.conversations set assigned_to = v_new where id = r.conv_id;
    select coalesce(full_name, email) into v_from from public.profiles where id = r.owner_id;
    select coalesce(full_name, email) into v_to from public.profiles where id = v_new;
    insert into public.activities (company_id, lead_id, kind, body)
    values (r.company_id, r.lead_id, 'assignment',
            'Repasse automático: ' || coalesce(v_from, 'vendedor') || ' não respondeu em ' || r.mins || ' min; lead passou para ' || coalesce(v_to, 'vendedor'));
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;
revoke execute on function public.reassign_unanswered() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- LocPress: ordem de prioridade, repasse da Isabela em 20 min e Thays nos dias de trabalho
-- ---------------------------------------------------------------------
with lp as (select id from public.companies where slug = 'locpress'),
     u as (
       select
         (select m.user_id from public.memberships m join public.profiles p on p.id = m.user_id, lp where m.company_id = lp.id and p.full_name ilike 'Isabela%' limit 1) as isabela,
         (select m.user_id from public.memberships m join public.profiles p on p.id = m.user_id, lp where m.company_id = lp.id and p.full_name ilike 'Thays%' limit 1) as thays,
         (select m.user_id from public.memberships m join public.profiles p on p.id = m.user_id, lp where m.company_id = lp.id and p.full_name ilike 'Deusdeth%' limit 1) as deusdeth
     ),
     f as (
       select
         (select p.id from public.pipelines p, lp where p.company_id = lp.id and p.key = 'homecare') as homecare,
         (select p.id from public.pipelines p, lp where p.company_id = lp.id and p.key = 'venda') as venda,
         (select p.id from public.pipelines p, lp where p.company_id = lp.id and p.key = 'locacao') as locacao
     )
update public.lead_distribution d
set enabled = true,
    priority = jsonb_build_object(
      f.homecare::text, jsonb_build_array(u.isabela, u.thays),
      f.venda::text,    jsonb_build_array(u.deusdeth, u.isabela, u.thays),
      f.locacao::text,  jsonb_build_array(u.deusdeth, u.isabela, u.thays)),
    reassign_minutes = coalesce(d.reassign_minutes, '{}'::jsonb) || jsonb_build_object(u.isabela::text, 20),
    work_days = coalesce(d.work_days, '{}'::jsonb) || jsonb_build_object(u.thays::text, jsonb_build_array(1, 2, 3, 4, 5, 6)),
    updated_at = now()
from lp, u, f
where d.company_id = lp.id and u.isabela is not null and u.thays is not null and u.deusdeth is not null;

-- Triagem com botões no primeiro contato (lead novo sem palavra-chave).
insert into public.whatsapp_triage (company_id, enabled, intro, options)
select c.id, true,
       'Olá! Aqui é a ' || c.name || '. Para te atender mais rápido, escolha o assunto:',
       jsonb_build_array(
         jsonb_build_object('title', 'CPAP e oxigênio', 'pipeline_id', (select id from public.pipelines where company_id = c.id and key = 'homecare')),
         jsonb_build_object('title', 'Comprar equipamento', 'pipeline_id', (select id from public.pipelines where company_id = c.id and key = 'venda')),
         jsonb_build_object('title', 'Alugar equipamento', 'pipeline_id', (select id from public.pipelines where company_id = c.id and key = 'locacao'))
       )
from public.companies c
where c.slug = 'locpress'
on conflict (company_id) do nothing;
