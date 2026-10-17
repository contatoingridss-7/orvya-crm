-- =====================================================================
-- Orvya — logística, agendamento, CPAP na IC Supra e fotos do catálogo.
--
-- 1. Perfil "Expedição" (logistica): vê só os pedidos agendados para entrega ou
--    adaptação, com os dados necessários para separar, faturar e entregar.
--    Não vê conversas, valores, tarefas nem dados de saúde (SPEC 1.4).
-- 2. Vendedor restrito a funis (memberships.pipeline_ids): ex.: Thays só no CPAP.
-- 3. Agendamento no lead (data/hora, endereço, observação) e etapas
--    "Entrega agendada" / "Adaptação programada" ligadas à expedição.
-- 4. Automações "ao entregar" (follow-up do CPAP: 24 h, 7 e 15 dias).
-- 5. Funil CPAP na IC Supra.
-- 6. Fotos dos produtos (bucket público product-photos).
--
-- Pode ser executado mais de uma vez.
-- O novo valor do enum é comparado como texto (role::text) para funcionar na
-- mesma transação em que é criado.
-- =====================================================================

alter type public.member_role add value if not exists 'logistica';

-- ---------------------------------------------------------------------
-- Colunas novas
-- ---------------------------------------------------------------------
alter table public.memberships
  add column if not exists pipeline_ids uuid[];          -- null = todos os funis da empresa

alter table public.stages
  add column if not exists logistics text check (logistics in ('entrega', 'adaptacao'));

alter table public.automation_rules
  add column if not exists trigger_event text not null default 'stage' check (trigger_event in ('stage', 'delivered'));

alter table public.leads
  add column if not exists scheduled_at      timestamptz,
  add column if not exists logistics_address text,
  add column if not exists logistics_notes   text,
  add column if not exists logistics_status  text check (logistics_status in ('agendado', 'separado', 'faturado', 'em_rota', 'entregue')),
  add column if not exists delivered_at      timestamptz;
create index if not exists leads_scheduled_idx on public.leads (company_id, scheduled_at) where scheduled_at is not null;

alter table public.products
  add column if not exists photo_path text;

-- ---------------------------------------------------------------------
-- Funções de acesso
-- ---------------------------------------------------------------------

-- Acesso comercial (vendedor, gestor, admin). A expedição fica de fora:
-- todas as políticas que já usavam esta função passam a excluir a expedição.
create or replace function public.has_company_access(cid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_platform_admin() or exists (
    select 1
    from public.memberships m
    join public.profiles p on p.id = m.user_id
    where m.user_id = (select auth.uid()) and m.company_id = cid and p.active
      and m.role::text <> 'logistica');
$$;

-- Qualquer vínculo ativo com a empresa, inclusive expedição.
create or replace function public.has_any_access(cid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_platform_admin() or exists (
    select 1
    from public.memberships m
    join public.profiles p on p.id = m.user_id
    where m.user_id = (select auth.uid()) and m.company_id = cid and p.active);
$$;

create or replace function public.is_logistics(cid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.memberships m
    join public.profiles p on p.id = m.user_id
    where m.user_id = (select auth.uid()) and m.company_id = cid and p.active
      and m.role::text = 'logistica');
$$;

-- Funis que o usuário pode ver na empresa (null = todos).
create or replace function public.pipeline_scope(cid uuid)
returns uuid[] language sql stable security definer set search_path = '' as $$
  select case when public.is_company_manager(cid) then null
              else (select m.pipeline_ids from public.memberships m
                    where m.user_id = (select auth.uid()) and m.company_id = cid)
         end;
$$;

create or replace function public.can_see_pipeline(cid uuid, pid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.pipeline_scope(cid) is null or pid = any (public.pipeline_scope(cid));
$$;

-- Conversa: regra dos leads (dono ou fila) e, para vendedor restrito a funis,
-- só a fila de conversas ligadas a leads desses funis.
create or replace function public.can_see_conversation(cid uuid, assigned uuid, lead uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.can_see_owned(cid, assigned) and (
       assigned = (select auth.uid())
    or public.pipeline_scope(cid) is null
    or exists (select 1 from public.leads l where l.id = lead and l.pipeline_id = any (public.pipeline_scope(cid))));
$$;

-- ---------------------------------------------------------------------
-- Políticas alteradas
-- ---------------------------------------------------------------------
drop policy if exists companies_select on public.companies;
create policy companies_select on public.companies for select to authenticated
  using (public.has_any_access(id));

drop policy if exists memberships_select on public.memberships;
create policy memberships_select on public.memberships for select to authenticated
  using (public.has_company_access(company_id) or user_id = (select auth.uid()));

-- Expedição lê funis, etapas e catálogo.
drop policy if exists pipelines_select on public.pipelines;
create policy pipelines_select on public.pipelines for select to authenticated
  using (public.has_any_access(company_id));
drop policy if exists stages_select on public.stages;
create policy stages_select on public.stages for select to authenticated
  using (public.has_any_access(company_id));
drop policy if exists products_select on public.products;
create policy products_select on public.products for select to authenticated
  using (public.has_any_access(company_id));

-- Leads: além da regra de dono, o vendedor restrito só vê os funis dele.
drop policy if exists leads_select on public.leads;
create policy leads_select on public.leads for select to authenticated
  using (public.can_see_owned(company_id, owner_id) and public.can_see_pipeline(company_id, pipeline_id));
drop policy if exists leads_insert on public.leads;
create policy leads_insert on public.leads for insert to authenticated
  with check (public.has_company_access(company_id) and public.can_see_pipeline(company_id, pipeline_id)
              and (public.is_company_manager(company_id) or owner_id is null or owner_id = (select auth.uid())));
drop policy if exists leads_update on public.leads;
create policy leads_update on public.leads for update to authenticated
  using (public.can_see_owned(company_id, owner_id) and public.can_see_pipeline(company_id, pipeline_id))
  with check (public.can_see_pipeline(company_id, pipeline_id)
              and (public.is_company_manager(company_id) or owner_id = (select auth.uid())));

drop policy if exists conversations_select on public.conversations;
create policy conversations_select on public.conversations for select to authenticated
  using (public.can_see_conversation(company_id, assigned_to, lead_id));
drop policy if exists conversations_update on public.conversations;
create policy conversations_update on public.conversations for update to authenticated
  using (public.can_see_conversation(company_id, assigned_to, lead_id))
  with check (public.is_company_manager(company_id) or assigned_to = (select auth.uid()));

-- ---------------------------------------------------------------------
-- Automações: as de etapa continuam no gatilho; as "ao entregar" rodam na expedição.
-- ---------------------------------------------------------------------
create or replace function public.leads_after_stage_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_from text;
  v_to text;
  r record;
begin
  select name into v_from from public.stages where id = old.stage_id;
  select name into v_to   from public.stages where id = new.stage_id;

  insert into public.activities (company_id, lead_id, kind, body, user_id, meta)
  values (new.company_id, new.id, 'stage_change',
          'Etapa alterada de ' || coalesce(v_from, '?') || ' para ' || coalesce(v_to, '?')
            || case when new.lost_reason is not null then '. Motivo: ' || new.lost_reason else '' end,
          (select auth.uid()),
          jsonb_build_object('from', old.stage_id, 'to', new.stage_id));

  for r in
    select * from public.automation_rules
    where enabled and trigger_event = 'stage'
      and company_id = new.company_id and pipeline_id = new.pipeline_id and stage_id = new.stage_id
  loop
    insert into public.tasks (company_id, lead_id, title, due_at, owner_id, origin, automation_rule_id)
    values (new.company_id, new.id, r.task_title, now() + make_interval(days => r.due_in_days),
            new.owner_id, 'automation', r.id);

    insert into public.activities (company_id, lead_id, kind, body, meta)
    values (new.company_id, new.id, 'automation',
            'Automação criou a tarefa "' || r.task_title || '"',
            jsonb_build_object('rule_id', r.id));
  end loop;

  return new;
end $$;

-- ---------------------------------------------------------------------
-- Expedição: lista de pedidos e avanço de status
-- ---------------------------------------------------------------------

-- Só o necessário para separar, faturar e entregar. Sem valores, conversas,
-- campos do funil (receita, médico, pressão) nem tarefas.
create or replace function public.logistics_orders(p_company uuid)
returns table (
  lead_id         uuid,
  kind            text,
  pipeline_name   text,
  stage_name      text,
  contact_name    text,
  contact_phone   text,
  address         text,
  scheduled_at    timestamptz,
  status          text,
  notes           text,
  delivered_at    timestamptz,
  owner_name      text,
  products        jsonb
)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not (public.is_logistics(p_company) or public.is_company_manager(p_company)) then
    raise exception 'Sem acesso à expedição';
  end if;

  return query
  select l.id,
         coalesce(s.logistics, 'entrega'),
         pl.name, s.name, c.name, c.phone_e164,
         l.logistics_address, l.scheduled_at, coalesce(l.logistics_status, 'agendado'), l.logistics_notes, l.delivered_at,
         pr.full_name,
         coalesce((select jsonb_agg(jsonb_build_object('name', p.name, 'code', p.code, 'quantity', lp.quantity, 'mode', lp.mode,
                                                       'photo', p.photo_path) order by p.name)
                   from public.lead_products lp join public.products p on p.id = lp.product_id
                   where lp.lead_id = l.id), '[]'::jsonb)
  from public.leads l
  join public.stages s on s.id = l.stage_id
  join public.pipelines pl on pl.id = l.pipeline_id
  join public.contacts c on c.id = l.contact_id
  left join public.profiles pr on pr.id = l.owner_id
  where l.company_id = p_company
    and l.scheduled_at is not null
    and (
      (s.logistics is not null and coalesce(l.logistics_status, 'agendado') <> 'entregue')
      or l.delivered_at > now() - interval '7 days'
    )
  order by l.scheduled_at;
end $$;

create or replace function public.logistics_set_status(p_lead uuid, p_status text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_lead public.leads%rowtype;
  v_stage public.stages%rowtype;
  v_won uuid;
  v_label text;
  r record;
begin
  select * into v_lead from public.leads where id = p_lead;
  if v_lead.id is null then raise exception 'Pedido não encontrado'; end if;
  if not (public.is_logistics(v_lead.company_id) or public.is_company_manager(v_lead.company_id)) then
    raise exception 'Sem acesso à expedição';
  end if;
  if p_status not in ('agendado', 'separado', 'faturado', 'em_rota', 'entregue') then
    raise exception 'Status inválido';
  end if;
  if coalesce(v_lead.logistics_status, 'agendado') = 'entregue' then
    raise exception 'Pedido já entregue';
  end if;

  select * into v_stage from public.stages where id = v_lead.stage_id;
  if v_stage.logistics is null then
    raise exception 'O lead saiu da etapa de entrega. Fale com o vendedor';
  end if;

  v_label := case p_status
    when 'agendado' then 'Agendado' when 'separado' then 'Separado' when 'faturado' then 'Faturado'
    when 'em_rota' then 'Saiu para entrega'
    else case when v_stage.logistics = 'adaptacao' then 'Equipamento entregue para adaptação' else 'Entregue' end end;

  update public.leads
  set logistics_status = p_status,
      delivered_at = case when p_status = 'entregue' then now() else null end
  where id = p_lead;

  insert into public.activities (company_id, lead_id, kind, body, user_id, meta)
  values (v_lead.company_id, p_lead, 'system', 'Expedição: ' || v_label, (select auth.uid()),
          jsonb_build_object('logistics_status', p_status));

  if p_status = 'entregue' then
    -- Automações "ao entregar" desta etapa (ex.: follow-up do CPAP em 24 h, 7 e 15 dias).
    for r in
      select * from public.automation_rules
      where enabled and trigger_event = 'delivered' and stage_id = v_stage.id
    loop
      insert into public.tasks (company_id, lead_id, title, due_at, owner_id, origin, automation_rule_id)
      values (v_lead.company_id, p_lead, r.task_title, now() + make_interval(days => r.due_in_days),
              v_lead.owner_id, 'automation', r.id);
      insert into public.activities (company_id, lead_id, kind, body, meta)
      values (v_lead.company_id, p_lead, 'automation', 'Automação criou a tarefa "' || r.task_title || '"',
              jsonb_build_object('rule_id', r.id));
    end loop;

    -- Entrega concluída: o negócio vai para a etapa de ganho do funil
    -- (adaptação in loco continua na etapa, aguardando o resultado do teste).
    if v_stage.logistics = 'entrega' then
      select id into v_won from public.stages where pipeline_id = v_lead.pipeline_id and kind = 'won' order by position limit 1;
      if v_won is not null then
        update public.leads set stage_id = v_won where id = p_lead;
      end if;
    end if;
  end if;

  return p_status;
end $$;

revoke all on function public.logistics_orders(uuid) from public, anon;
revoke all on function public.logistics_set_status(uuid, text) from public, anon;
grant execute on function public.logistics_orders(uuid) to authenticated;
grant execute on function public.logistics_set_status(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- Fotos do catálogo: bucket público (a foto pode ir para o cliente no WhatsApp).
-- Envio e troca: gestor, admin e expedição da empresa (pasta = id da empresa).
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-photos', 'product-photos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = 5242880, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

create or replace function public.can_manage_product_photos(p_folder text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.companies co
    where co.id::text = p_folder and (public.is_company_manager(co.id) or public.is_logistics(co.id)));
$$;

drop policy if exists product_photos_insert on storage.objects;
create policy product_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'product-photos' and public.can_manage_product_photos((storage.foldername(name))[1]));
drop policy if exists product_photos_update on storage.objects;
create policy product_photos_update on storage.objects for update to authenticated
  using (bucket_id = 'product-photos' and public.can_manage_product_photos((storage.foldername(name))[1]));
drop policy if exists product_photos_delete on storage.objects;
create policy product_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'product-photos' and public.can_manage_product_photos((storage.foldername(name))[1]));

-- Grava o caminho da foto no produto (a expedição não edita o resto do produto).
create or replace function public.set_product_photo(p_product uuid, p_path text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_company uuid;
begin
  select company_id into v_company from public.products where id = p_product;
  if v_company is null then raise exception 'Produto não encontrado'; end if;
  if not (public.is_company_manager(v_company) or public.is_logistics(v_company)) then
    raise exception 'Sem permissão para alterar a foto';
  end if;
  if p_path is not null and p_path not like v_company::text || '/%' then
    raise exception 'Caminho de foto inválido';
  end if;
  update public.products set photo_path = p_path where id = p_product;
end $$;

revoke all on function public.set_product_photo(uuid, text) from public, anon;
grant execute on function public.set_product_photo(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- Funis: etapas de entrega e adaptação, funil CPAP na IC Supra
-- ---------------------------------------------------------------------
do $$
declare
  c_supra uuid;
  c_loc uuid;
  p record;
  v_won_pos int;
  v_cpap uuid;
  v_stage uuid;
  i int;
  keys  text[] := array['novo','avaliacao','teste','proposta','entrega','ganho','perdido'];
  names text[] := array['Novo contato','Receita e avaliação','Adaptação programada','Proposta','Entrega agendada','Fechado','Perdido'];
  kinds text[] := array['open','open','open','open','open','won','lost'];
  logi  text[] := array[null,null,'adaptacao',null,'entrega',null,null];
begin
  select id into c_supra from public.companies where slug = 'ic-supra';
  select id into c_loc   from public.companies where slug = 'locpress';

  -- "Entrega agendada" antes do ganho nos funis de venda (IC Varejo, IC Institucional,
  -- LocPress Venda) e no CPAP da LocPress.
  for p in
    select pl.id, pl.company_id from public.pipelines pl
    where (pl.company_id = c_supra and pl.key in ('varejo', 'b2b'))
       or (pl.company_id = c_loc and pl.key in ('venda', 'homecare'))
  loop
    if not exists (select 1 from public.stages where pipeline_id = p.id and key = 'entrega') then
      select min(position) into v_won_pos from public.stages where pipeline_id = p.id and kind <> 'open';
      update public.stages set position = position + 1 where pipeline_id = p.id and position >= v_won_pos;
      insert into public.stages (company_id, pipeline_id, key, name, kind, position, logistics)
      values (p.company_id, p.id, 'entrega', 'Entrega agendada', 'open', v_won_pos, 'entrega');
    end if;
  end loop;

  -- Locação já tinha "Entrega agendada": passa a aparecer para a expedição.
  update public.stages s set logistics = 'entrega'
  from public.pipelines pl
  where s.pipeline_id = pl.id and pl.company_id = c_loc and pl.key = 'locacao' and s.key = 'entrega' and s.logistics is null;

  -- CPAP da LocPress: "Teste de adaptação" vira "Adaptação programada" (teste in loco agendado).
  update public.stages s set name = 'Adaptação programada', logistics = 'adaptacao'
  from public.pipelines pl
  where s.pipeline_id = pl.id and pl.company_id = c_loc and pl.key = 'homecare' and s.key = 'teste';

  -- LocPress Venda: a tarefa de agendar a entrega sai do ganho e vai para a nova etapa.
  update public.automation_rules r
  set stage_id = s.id, task_title = 'Confirmar endereço e horário da entrega', due_in_days = 0
  from public.stages s, public.pipelines pl
  where r.pipeline_id = pl.id and pl.company_id = c_loc and pl.key = 'venda'
    and s.pipeline_id = pl.id and s.key = 'entrega'
    and r.task_title = 'Agendar entrega e instalação';

  -- Funil CPAP na IC Supra -------------------------------------------
  if c_supra is not null then
    select id into v_cpap from public.pipelines where company_id = c_supra and key = 'cpap';
    if v_cpap is null then
      insert into public.pipelines (company_id, key, name, hint, position)
      values (c_supra, 'cpap', 'CPAP', 'Venda e locação de CPAP', 3)
      returning id into v_cpap;
      for i in 1 .. array_length(keys, 1) loop
        insert into public.stages (company_id, pipeline_id, key, name, kind, position, logistics)
        values (c_supra, v_cpap, keys[i], names[i], kinds[i]::public.stage_kind, i, logi[i]);
      end loop;

      insert into public.custom_fields (company_id, pipeline_id, key, label, field_type, options, position, full_width) values
        (c_supra, v_cpap, 'modalidade', 'Modalidade', 'select', array['A definir','Compra','Locação'], 1, false),
        (c_supra, v_cpap, 'receita', 'Receita médica', 'select', array['Pendente','Recebida','Não precisa'], 2, false),
        (c_supra, v_cpap, 'medico', 'Médico solicitante', 'text', null, 3, false),
        (c_supra, v_cpap, 'pressao', 'Pressão prescrita (cmH₂O)', 'text', null, 4, false),
        (c_supra, v_cpap, 'mascara', 'Máscara', 'select', array['A definir','Nasal','Oronasal','Almofada nasal'], 5, false);

      insert into public.automation_rules (company_id, pipeline_id, stage_id, task_title, due_in_days, enabled)
      select c_supra, v_cpap, s.id, t.title, t.days, true
      from (values ('teste', 'Avaliar a adaptação ao CPAP com o paciente', 1),
                   ('proposta', 'Retornar a proposta de CPAP', 2),
                   ('entrega', 'Confirmar endereço e horário da entrega', 0)) as t(stage_key, title, days)
      join public.stages s on s.pipeline_id = v_cpap and s.key = t.stage_key;
    end if;
  end if;

  -- Follow-up do CPAP ao entregar (regra da empresa: 24 h, 7 dias e 15 dias) ----
  for p in
    select pl.id, pl.company_id, s.id as stage_id from public.pipelines pl
    join public.stages s on s.pipeline_id = pl.id and s.key = 'entrega'
    where (pl.company_id = c_supra and pl.key = 'cpap') or (pl.company_id = c_loc and pl.key = 'homecare')
  loop
    insert into public.automation_rules (company_id, pipeline_id, stage_id, task_title, due_in_days, enabled, trigger_event)
    select p.company_id, p.id, p.stage_id, t.title, t.days, true, 'delivered'
    from (values ('Follow-up CPAP 24 h: como foi a primeira noite?', 1),
                 ('Follow-up CPAP 7 dias: adaptação e uso diário', 7),
                 ('Follow-up CPAP 15 dias: conforto da máscara e próximos passos', 15)) as t(title, days)
    where not exists (select 1 from public.automation_rules r where r.stage_id = p.stage_id and r.task_title = t.title);
  end loop;
end $$;
