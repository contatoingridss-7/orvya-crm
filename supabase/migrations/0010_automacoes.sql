-- =====================================================================
-- Orvya — automações de controle da demanda.
--
-- 1. Tarefas prontas (task_templates): frases pré-cadastradas por funil para o
--    campo "O que precisa ser feito"; o vendedor escolhe e edita se precisar.
-- 2. Regra "parado na etapa" (trigger_event = 'stale'): lead há N dias na mesma
--    etapa vira tarefa para o responsável. Roda pelo pg_cron (de hora em hora)
--    e pelo cron diário da Vercel (/api/jobs/automacoes).
-- 3. Repetição (repeat_days): ao concluir a tarefa, nasce a próxima. Usada na
--    reposição de consumíveis do CPAP (filtro todo mês, máscara a cada 3 meses).
--
-- Pode ser executado mais de uma vez.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Tarefas prontas
-- ---------------------------------------------------------------------
create table if not exists public.task_templates (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete cascade,
  pipeline_id  uuid references public.pipelines (id) on delete cascade,   -- null = todos os funis
  title        text not null check (char_length(title) between 3 and 200),
  due_in_days  int not null default 1 check (due_in_days between 0 and 365), -- 0 = hoje (em 2 h); N = em N dias às 9h
  position     int not null default 0,
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);
create index if not exists task_templates_company_idx on public.task_templates (company_id, active);

alter table public.task_templates enable row level security;
drop policy if exists task_templates_select on public.task_templates;
create policy task_templates_select on public.task_templates for select to authenticated
  using (public.has_company_access(company_id));
drop policy if exists task_templates_write on public.task_templates;
create policy task_templates_write on public.task_templates for all to authenticated
  using (public.is_company_manager(company_id)) with check (public.is_company_manager(company_id));

-- ---------------------------------------------------------------------
-- 2 e 3. Regras: parado na etapa e repetição
-- ---------------------------------------------------------------------
alter table public.automation_rules
  add column if not exists after_days  int check (after_days between 1 and 365),   -- 'stale': dias parado na etapa
  add column if not exists repeat_days int check (repeat_days between 1 and 365);  -- ao concluir, cria a próxima

alter table public.automation_rules drop constraint if exists automation_rules_trigger_event_check;
alter table public.automation_rules add constraint automation_rules_trigger_event_check
  check (trigger_event in ('stage', 'delivered', 'stale'));

-- Desde quando o lead está na etapa atual.
alter table public.leads add column if not exists stage_entered_at timestamptz;
update public.leads l
set stage_entered_at = coalesce(
  (select max(a.created_at) from public.activities a where a.lead_id = l.id and a.kind = 'stage_change'),
  l.created_at)
where l.stage_entered_at is null;
alter table public.leads alter column stage_entered_at set default now();
create index if not exists leads_stage_entered_idx on public.leads (stage_id, stage_entered_at) where closed_at is null;

-- leads_guard (0001) + marca stage_entered_at quando a etapa muda.
create or replace function public.leads_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_kind public.stage_kind;
  v_pipeline uuid;
  v_company uuid;
begin
  select s.kind, s.pipeline_id, s.company_id into v_kind, v_pipeline, v_company
  from public.stages s where s.id = new.stage_id;

  if v_pipeline is null or v_pipeline <> new.pipeline_id or v_company <> new.company_id then
    raise exception 'Etapa não pertence ao funil ou à empresa do lead';
  end if;

  if v_kind = 'lost' and coalesce(btrim(new.lost_reason), '') = '' then
    raise exception 'Informe o motivo da perda';
  end if;

  if tg_op = 'INSERT' or new.stage_id is distinct from old.stage_id then
    new.stage_entered_at := now();
    if v_kind = 'open' then
      new.closed_at := null;
      new.lost_reason := null;
    else
      new.closed_at := coalesce(new.closed_at, now());
    end if;
  end if;

  return new;
end $$;

-- Cria as tarefas de "parado na etapa". Uma por lead e por regra a cada vez que o
-- lead entra na etapa (não repete enquanto ele continuar parado).
create or replace function public.run_stale_automations()
returns int language plpgsql security definer set search_path = '' as $$
declare
  r record;
  v_total int := 0;
  v_count int;
begin
  for r in
    select * from public.automation_rules where enabled and trigger_event = 'stale' and after_days is not null
  loop
    with due as (
      select l.id, l.company_id, l.owner_id
      from public.leads l
      where l.stage_id = r.stage_id and l.closed_at is null
        and l.stage_entered_at <= now() - make_interval(days => r.after_days)
        and not exists (select 1 from public.tasks t
                        where t.lead_id = l.id and t.automation_rule_id = r.id and t.created_at >= l.stage_entered_at)
    ), ins as (
      insert into public.tasks (company_id, lead_id, title, due_at, owner_id, origin, automation_rule_id)
      select d.company_id, d.id, r.task_title, now() + make_interval(days => r.due_in_days), d.owner_id, 'automation', r.id
      from due d
      returning lead_id, company_id
    ), act as (
      insert into public.activities (company_id, lead_id, kind, body, meta)
      select i.company_id, i.lead_id, 'automation',
             'Lead parado há ' || r.after_days || ' dia(s) na etapa: automação criou a tarefa "' || r.task_title || '"',
             jsonb_build_object('rule_id', r.id)
      from ins i
      returning 1
    )
    select count(*) into v_count from act;
    v_total := v_total + v_count;
  end loop;
  return v_total;
end $$;

revoke all on function public.run_stale_automations() from public, anon, authenticated;
grant execute on function public.run_stale_automations() to service_role;

-- Repetição: ao concluir uma tarefa de regra com repeat_days, agenda a próxima
-- (se o lead não foi perdido e não há outra igual em aberto).
create or replace function public.tasks_after_done()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  r record;
  v_owner uuid;
  v_lost boolean;
begin
  select * into r from public.automation_rules where id = new.automation_rule_id;
  if r.id is null or not r.enabled or r.repeat_days is null or new.lead_id is null then
    return new;
  end if;

  select l.owner_id, s.kind = 'lost' into v_owner, v_lost
  from public.leads l join public.stages s on s.id = l.stage_id where l.id = new.lead_id;
  if v_lost is null or v_lost then
    return new;
  end if;

  if exists (select 1 from public.tasks t where t.lead_id = new.lead_id and t.automation_rule_id = r.id and t.done_at is null and t.id <> new.id) then
    return new;
  end if;

  insert into public.tasks (company_id, lead_id, title, due_at, owner_id, origin, automation_rule_id)
  values (new.company_id, new.lead_id, r.task_title, now() + make_interval(days => r.repeat_days), v_owner, 'automation', r.id);

  insert into public.activities (company_id, lead_id, kind, body, meta)
  values (new.company_id, new.lead_id, 'automation',
          'Tarefa concluída. Próxima "' || r.task_title || '" em ' || r.repeat_days || ' dia(s)',
          jsonb_build_object('rule_id', r.id));
  return new;
end $$;

drop trigger if exists tasks_after_done_trg on public.tasks;
create trigger tasks_after_done_trg
  after update of done_at on public.tasks
  for each row when (old.done_at is null and new.done_at is not null and new.automation_rule_id is not null)
  execute function public.tasks_after_done();

-- ---------------------------------------------------------------------
-- Dados iniciais (editáveis em Automações)
-- ---------------------------------------------------------------------
do $$
declare
  c_supra uuid;
  c_loc uuid;
begin
  select id into c_supra from public.companies where slug = 'ic-supra';
  select id into c_loc   from public.companies where slug = 'locpress';

  -- Tarefas prontas por funil ----------------------------------------
  insert into public.task_templates (company_id, pipeline_id, title, due_in_days, position)
  select pl.company_id, case when t.pkey = '*' then null else pl.id end, t.title, t.days, t.pos
  from (values
    -- todos os funis
    ('*', 'Ligar para o cliente', 0, 1),
    ('*', 'Responder a dúvida do cliente', 0, 2),
    ('*', 'Enviar fotos e detalhes do produto', 0, 3),
    ('*', 'Confirmar forma de pagamento', 1, 4),
    -- vendas
    ('varejo', 'Enviar orçamento', 0, 10),
    ('varejo', 'Cobrar retorno do orçamento', 2, 11),
    ('varejo', 'Confirmar entrega ou retirada na loja', 1, 12),
    ('venda', 'Enviar orçamento', 0, 10),
    ('venda', 'Cobrar retorno do orçamento', 2, 11),
    ('venda', 'Confirmar endereço e horário da instalação', 1, 12),
    ('b2b', 'Enviar cotação', 0, 10),
    ('b2b', 'Confirmar recebimento da cotação com o comprador', 1, 11),
    ('b2b', 'Agendar visita à instituição', 3, 12),
    -- locação
    ('locacao', 'Conferir documentos do contrato', 1, 10),
    ('locacao', 'Enviar contrato para assinatura', 0, 11),
    ('locacao', 'Agendar recolhimento do equipamento', 1, 12),
    -- CPAP
    ('cpap', 'Cobrar receita médica', 1, 10),
    ('cpap', 'Confirmar horário da adaptação', 1, 11),
    ('cpap', 'Enviar vídeo de uso e limpeza da máscara', 0, 12),
    ('cpap', 'Perguntar como foi a noite com o CPAP', 1, 13),
    ('homecare', 'Cobrar receita médica', 1, 10),
    ('homecare', 'Confirmar horário da adaptação', 1, 11),
    ('homecare', 'Enviar vídeo de uso e limpeza da máscara', 0, 12),
    ('homecare', 'Perguntar como foi a noite com o CPAP', 1, 13)
  ) as t(pkey, title, days, pos)
  join public.pipelines pl
    on pl.company_id in (c_supra, c_loc)
   and (t.pkey = pl.key or (t.pkey = '*' and pl.position = (select min(p2.position) from public.pipelines p2 where p2.company_id = pl.company_id)))
  where not exists (
    select 1 from public.task_templates x
    where x.company_id = pl.company_id and x.title = t.title
      and x.pipeline_id is not distinct from (case when t.pkey = '*' then null else pl.id end));

  -- Lead parado na etapa ------------------------------------------------
  insert into public.automation_rules (company_id, pipeline_id, stage_id, task_title, due_in_days, after_days, enabled, trigger_event)
  select pl.company_id, pl.id, s.id, t.title, 0, t.after, true, 'stale'
  from (values
    ('*',        'novo',       1, 'Lead novo parado há 1 dia: qualificar e fazer o primeiro contato'),
    ('varejo',   'orcamento',  3, 'Orçamento sem resposta há 3 dias: retomar contato'),
    ('varejo',   'negociacao', 5, 'Negociação parada há 5 dias: propor fechamento'),
    ('venda',    'orcamento',  3, 'Orçamento sem resposta há 3 dias: retomar contato'),
    ('venda',    'negociacao', 5, 'Negociação parada há 5 dias: propor fechamento'),
    ('b2b',      'cotacao',    5, 'Cotação parada há 5 dias: falar com o comprador'),
    ('locacao',  'documentacao', 2, 'Documentação parada há 2 dias: cobrar os documentos'),
    ('cpap',     'avaliacao',  3, 'Receita e avaliação paradas há 3 dias: cobrar a receita'),
    ('cpap',     'proposta',   3, 'Proposta de CPAP sem resposta há 3 dias: retomar contato'),
    ('homecare', 'avaliacao',  3, 'Receita e avaliação paradas há 3 dias: cobrar a receita'),
    ('homecare', 'proposta',   3, 'Proposta de CPAP sem resposta há 3 dias: retomar contato')
  ) as t(pkey, skey, after, title)
  join public.pipelines pl on pl.company_id in (c_supra, c_loc) and (t.pkey = '*' or t.pkey = pl.key)
  join public.stages s on s.pipeline_id = pl.id and s.key = t.skey
  where not exists (select 1 from public.automation_rules r where r.stage_id = s.id and r.trigger_event = 'stale');

  -- Reposição de consumíveis do CPAP (ao entregar, repetindo) -----------
  insert into public.automation_rules (company_id, pipeline_id, stage_id, task_title, due_in_days, repeat_days, enabled, trigger_event)
  select pl.company_id, pl.id, s.id, t.title, t.days, t.days, true, 'delivered'
  from (values
    ('Reposição CPAP: oferecer filtro novo', 30),
    ('Reposição CPAP: oferecer máscara nova', 90)
  ) as t(title, days)
  join public.pipelines pl on (pl.company_id = c_supra and pl.key = 'cpap') or (pl.company_id = c_loc and pl.key = 'homecare')
  join public.stages s on s.pipeline_id = pl.id and s.key = 'entrega'
  where not exists (select 1 from public.automation_rules r where r.stage_id = s.id and r.task_title = t.title);
end $$;

-- ---------------------------------------------------------------------
-- Agendamento de hora em hora no próprio banco (se o pg_cron estiver ligado).
-- Sem pg_cron, o cron diário da Vercel (/api/jobs/automacoes) cobre.
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('orvya-automacoes-parado', '15 * * * *', 'select public.run_stale_automations()');
  end if;
end $$;
