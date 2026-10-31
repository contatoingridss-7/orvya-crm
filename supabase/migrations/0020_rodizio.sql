-- =====================================================================
-- Orvya — Rodízio de leads e direcionamento por palavra-chave.
--
-- - lead_distribution (por empresa): rodízio ligado/desligado e rotas por palavra-chave
--   (ex.: mensagem com "cpap" abre o lead no funil CPAP). As rotas são aplicadas pelo
--   webhook na criação do lead; o rodízio, pelo banco (vale para qualquer origem).
-- - Rodízio justo, por funil: cada lead novo sem dono vai para o próximo vendedor liberado
--   naquele funil (memberships.pipeline_ids) e que trabalha naquele dia (work_days), em ordem
--   fixa (nome), um de cada vez.
-- - Só no horário de atendimento (whatsapp_after_hours.hours). Fora dele, o lead fica sem
--   dono e é distribuído na abertura (distribute_pending_leads, chamado pela rotina das 8h).
-- - Lead movido para um funil em que o dono não trabalha volta para o rodízio desse funil.
-- Pode ser executado mais de uma vez.
-- =====================================================================

create table if not exists public.lead_distribution (
  company_id  uuid primary key references public.companies (id) on delete cascade,
  enabled     boolean not null default false,
  routes      jsonb not null default '[]'::jsonb,   -- [{"pipeline_id": "...", "keywords": ["cpap", "bipap"]}]
  work_days   jsonb not null default '{}'::jsonb,   -- {"<user_id>": [1,2,3,4,5]} dias ISO; ausente = todos os dias abertos
  updated_at  timestamptz not null default now()
);

alter table public.lead_distribution add column if not exists work_days jsonb not null default '{}'::jsonb;

-- Ponteiro do rodízio por funil (só o banco mexe).
create table if not exists public.lead_rotation (
  pipeline_id   uuid primary key references public.pipelines (id) on delete cascade,
  last_user_id  uuid references public.profiles (id) on delete set null,
  updated_at    timestamptz not null default now()
);

alter table public.lead_distribution enable row level security;
alter table public.lead_rotation     enable row level security;   -- sem política: só funções do banco

drop policy if exists lead_distribution_select on public.lead_distribution;
create policy lead_distribution_select on public.lead_distribution for select to authenticated
  using (public.has_company_access(company_id));
drop policy if exists lead_distribution_write on public.lead_distribution;
create policy lead_distribution_write on public.lead_distribution for all to authenticated
  using (public.can_configure(company_id)) with check (public.can_configure(company_id));

-- ---------------------------------------------------------------------
-- Horário de atendimento (o mesmo da resposta fora do horário). Sem configuração = sempre aberto.
-- ---------------------------------------------------------------------
create or replace function public.company_is_open(p_company uuid, p_at timestamptz default now())
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  v_hours jsonb;
  v_local timestamp := p_at at time zone 'America/Fortaleza';
  v_day   jsonb;
  v_time  text := to_char(v_local, 'HH24:MI');
begin
  select hours into v_hours from public.whatsapp_after_hours where company_id = p_company;
  if v_hours is null then return true; end if;
  v_day := v_hours -> extract(isodow from v_local)::int::text;
  return v_day is not null and v_time >= (v_day ->> 0) and v_time < (v_day ->> 1);
end $$;

-- ---------------------------------------------------------------------
-- Próximo vendedor do funil (e avança o ponteiro).
-- ---------------------------------------------------------------------
create or replace function public.rotation_next(p_pipeline uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid;
  v_last    uuid;
  v_next    uuid;
  v_days    jsonb;
  v_today   int := extract(isodow from now() at time zone 'America/Fortaleza')::int;
begin
  select company_id into v_company from public.pipelines where id = p_pipeline;
  select work_days into v_days from public.lead_distribution where company_id = v_company;
  if v_company is null then return null; end if;
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
      -- Só quem trabalha hoje (ex.: sábado só a equipe do CPAP).
      and (v_days is null or not (v_days ? m.user_id::text) or (v_days -> m.user_id::text) @> to_jsonb(v_today))
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

-- ---------------------------------------------------------------------
-- Distribui um lead sem dono (se o rodízio estiver ligado e a empresa aberta).
-- ---------------------------------------------------------------------
create or replace function public.assign_lead_by_rotation(p_lead uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_lead  record;
  v_user  uuid;
  v_name  text;
begin
  select id, company_id, pipeline_id, owner_id, closed_at into v_lead from public.leads where id = p_lead for update;
  if v_lead.id is null or v_lead.owner_id is not null or v_lead.closed_at is not null then return null; end if;
  if not exists (select 1 from public.lead_distribution d where d.company_id = v_lead.company_id and d.enabled) then return null; end if;
  if not public.company_is_open(v_lead.company_id) then return null; end if;

  v_user := public.rotation_next(v_lead.pipeline_id);
  if v_user is null then return null; end if;

  update public.leads set owner_id = v_user where id = v_lead.id;
  update public.conversations set assigned_to = v_user where lead_id = v_lead.id and assigned_to is null;
  select coalesce(full_name, email) into v_name from public.profiles where id = v_user;
  insert into public.activities (company_id, lead_id, kind, body)
  values (v_lead.company_id, v_lead.id, 'assignment', 'Rodízio: lead distribuído para ' || coalesce(v_name, 'vendedor'));
  return v_user;
end $$;

-- Abertura do expediente: distribui os leads que chegaram fora do horário (últimos 4 dias).
-- Lead sem vendedor disponível hoje (ex.: Varejo no sábado) espera o próximo dia útil.
create or replace function public.distribute_pending_leads()
returns int language plpgsql security definer set search_path = '' as $$
declare
  v_id    uuid;
  v_count int := 0;
begin
  for v_id in
    select l.id
    from public.leads l
    join public.lead_distribution d on d.company_id = l.company_id and d.enabled
    where l.owner_id is null and l.closed_at is null and l.created_at > now() - interval '4 days'
    order by l.created_at
  loop
    if public.assign_lead_by_rotation(v_id) is not null then v_count := v_count + 1; end if;
  end loop;
  return v_count;
end $$;

-- ---------------------------------------------------------------------
-- Gatilhos
-- ---------------------------------------------------------------------
create or replace function public.leads_rotation_on_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.owner_id is null and new.closed_at is null then
    perform public.assign_lead_by_rotation(new.id);
  end if;
  return null;
end $$;

drop trigger if exists leads_rotation_insert on public.leads;
create trigger leads_rotation_insert after insert on public.leads
  for each row execute function public.leads_rotation_on_insert();

-- Lead mudou de funil e o dono (vendedor) não trabalha no funil novo: volta para o rodízio do funil.
create or replace function public.leads_rotation_on_pipeline()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.pipeline_id is distinct from old.pipeline_id
     and new.closed_at is null
     and new.owner_id is not null
     and exists (select 1 from public.lead_distribution d where d.company_id = new.company_id and d.enabled)
     and exists (
       select 1 from public.memberships m
       where m.company_id = new.company_id and m.user_id = new.owner_id and m.role = 'vendedor'
         and m.pipeline_ids is not null and cardinality(m.pipeline_ids) > 0 and not (new.pipeline_id = any (m.pipeline_ids))
     )
  then
    update public.leads set owner_id = null where id = new.id;
    update public.conversations set assigned_to = null where lead_id = new.id and assigned_to = old.owner_id;
    perform public.assign_lead_by_rotation(new.id);
  end if;
  return null;
end $$;

drop trigger if exists leads_rotation_pipeline on public.leads;
create trigger leads_rotation_pipeline after update of pipeline_id on public.leads
  for each row execute function public.leads_rotation_on_pipeline();

-- Conversa ligada a um lead com dono (rodízio ligado): a conversa vai junto para o dono.
create or replace function public.conversations_follow_lead_owner()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.assigned_to is null and new.lead_id is not null
     and exists (select 1 from public.lead_distribution d where d.company_id = new.company_id and d.enabled) then
    select owner_id into new.assigned_to from public.leads where id = new.lead_id;
  end if;
  return new;
end $$;

drop trigger if exists conversations_follow_owner on public.conversations;
create trigger conversations_follow_owner before insert or update of lead_id on public.conversations
  for each row execute function public.conversations_follow_lead_owner();

-- Só o servidor chama as funções diretamente (gatilhos rodam como dono).
revoke execute on function public.rotation_next(uuid) from public, anon, authenticated;
revoke execute on function public.assign_lead_by_rotation(uuid) from public, anon, authenticated;
revoke execute on function public.distribute_pending_leads() from public, anon, authenticated;
grant execute on function public.distribute_pending_leads() to service_role;

-- ---------------------------------------------------------------------
-- Configuração inicial (29/10/2026): IC Supra com rodízio ligado e "cpap" indo para o funil CPAP.
-- LocPress fica desligada até a equipe dela ser cadastrada.
-- ---------------------------------------------------------------------
insert into public.lead_distribution (company_id, enabled, routes)
select c.id,
       c.slug = 'ic-supra',
       coalesce(
         (select jsonb_build_array(jsonb_build_object('pipeline_id', p.id, 'keywords', jsonb_build_array('cpap', 'bipap', 'mascara de cpap', 'mascara nasal', 'mascara oronasal')))
          from public.pipelines p where p.company_id = c.id and p.key = 'cpap' and c.slug = 'ic-supra'),
         '[]'::jsonb)
from public.companies c
on conflict (company_id) do nothing;

-- Sábado: atendimento das 8h às 11h (ajuste combinado em 31/10/2026).
update public.whatsapp_after_hours
set hours = jsonb_set(hours, '{6}', '["08:00", "11:00"]'::jsonb),
    message = replace(message, 'aos sábados, das 8h às 12h', 'aos sábados, das 8h às 11h'),
    updated_at = now()
where hours -> '6' ->> 1 = '12:00';
