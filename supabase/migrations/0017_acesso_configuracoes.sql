-- =====================================================================
-- Orvya — acesso às configurações por gestor.
--
-- O gestor acompanha a operação da empresa (painel, funil, conversas, tarefas,
-- relatórios, vendas). Automações, Canais, Equipe e Agente de IA ficam só com o
-- administrador, a não ser que ele libere `settings_access` para aquele gestor
-- (na tela Equipe). Desligado por padrão.
-- Pode ser executado mais de uma vez.
-- =====================================================================

alter table public.memberships
  add column if not exists settings_access boolean not null default false;

-- Admin da plataforma, ou gestor ativo da empresa com acesso às configurações liberado.
create or replace function public.can_configure(cid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_platform_admin() or exists (
    select 1
    from public.memberships m
    join public.profiles p on p.id = m.user_id
    where m.user_id = (select auth.uid()) and m.company_id = cid and m.role = 'gestor' and m.settings_access and p.active);
$$;
revoke execute on function public.can_configure(uuid) from public, anon;
grant execute on function public.can_configure(uuid) to authenticated;

-- Regras por etapa: a equipe lê (as tarefas nascem pelo banco); editar exige o acesso.
drop policy if exists automation_rules_insert on public.automation_rules;
create policy automation_rules_insert on public.automation_rules for insert to authenticated
  with check (public.can_configure(company_id));
drop policy if exists automation_rules_update on public.automation_rules;
create policy automation_rules_update on public.automation_rules for update to authenticated
  using (public.can_configure(company_id)) with check (public.can_configure(company_id));
drop policy if exists automation_rules_delete on public.automation_rules;
create policy automation_rules_delete on public.automation_rules for delete to authenticated
  using (public.can_configure(company_id));

-- Tarefas prontas (o vendedor continua lendo para escolher).
drop policy if exists task_templates_write on public.task_templates;
create policy task_templates_write on public.task_templates for all to authenticated
  using (public.can_configure(company_id)) with check (public.can_configure(company_id));

-- Instagram: respostas automáticas e menu de boas-vindas.
drop policy if exists ig_auto_replies_write on public.ig_auto_replies;
create policy ig_auto_replies_write on public.ig_auto_replies for all to authenticated
  using (public.can_configure(company_id)) with check (public.can_configure(company_id));
drop policy if exists ig_welcome_menu_write on public.ig_welcome_menu;
create policy ig_welcome_menu_write on public.ig_welcome_menu for all to authenticated
  using (public.can_configure(company_id)) with check (public.can_configure(company_id));
