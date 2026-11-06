-- =====================================================================
-- Orvya — Triagem do WhatsApp e troca de funil que respeita o rodízio (pedido de 06/11/2026).
--
-- 1) Lead movido para um funil em que o dono NÃO recebe pelo rodízio (Distribuição de leads →
--    "Recebe leads") vai para quem recebe nesse funil. Ex.: Renato move um lead para o CPAP →
--    o lead e a conversa passam para a Thays. Antes só valia a restrição de Equipe (funis que vê).
-- 2) whatsapp_triage: no primeiro contato (lead novo sem palavra-chave), o cliente recebe uma
--    mensagem com até 3 botões; o botão escolhido leva o lead ao funil certo (e, pelo item 1,
--    ao vendedor certo). Vai dentro da janela aberta pelo cliente: sem custo.
-- Pode ser executado mais de uma vez.
-- =====================================================================

create or replace function public.leads_rotation_on_pipeline()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_rot jsonb;
begin
  if new.pipeline_id is distinct from old.pipeline_id
     and new.closed_at is null
     and new.owner_id is not null
     and exists (select 1 from public.lead_distribution d where d.company_id = new.company_id and d.enabled)
     and exists (select 1 from public.memberships m where m.company_id = new.company_id and m.user_id = new.owner_id and m.role = 'vendedor')
  then
    select rotation_pipelines into v_rot from public.lead_distribution where company_id = new.company_id;
    if exists (
         -- Não enxerga o funil novo (Equipe)...
         select 1 from public.memberships m
         where m.company_id = new.company_id and m.user_id = new.owner_id
           and m.pipeline_ids is not null and cardinality(m.pipeline_ids) > 0 and not (new.pipeline_id = any (m.pipeline_ids))
       )
       -- ...ou não recebe leads desse funil pelo rodízio.
       or (v_rot ? new.owner_id::text and not ((v_rot -> new.owner_id::text) @> to_jsonb(new.pipeline_id::text)))
    then
      update public.leads set owner_id = null where id = new.id;
      update public.conversations set assigned_to = null where lead_id = new.id and assigned_to = old.owner_id;
      if public.assign_lead_by_rotation(new.id) is null then
        -- Ninguém disponível no funil agora (almoço, fora do horário): fica com quem estava até a rotina distribuir.
        update public.leads set owner_id = old.owner_id where id = new.id and owner_id is null;
        update public.conversations set assigned_to = old.owner_id where lead_id = new.id and assigned_to is null;
      end if;
    end if;
  end if;
  return null;
end $$;

create table if not exists public.whatsapp_triage (
  company_id  uuid primary key references public.companies (id) on delete cascade,
  enabled     boolean not null default false,
  intro       text not null check (char_length(intro) between 1 and 1024),
  -- [{"title": "CPAP e apneia", "pipeline_id": "..."}] — até 3 botões, título com até 20 caracteres.
  options     jsonb not null default '[]'::jsonb,
  updated_at  timestamptz not null default now()
);

alter table public.whatsapp_triage enable row level security;
drop policy if exists whatsapp_triage_select on public.whatsapp_triage;
create policy whatsapp_triage_select on public.whatsapp_triage for select to authenticated
  using (public.has_company_access(company_id));
drop policy if exists whatsapp_triage_write on public.whatsapp_triage;
create policy whatsapp_triage_write on public.whatsapp_triage for all to authenticated
  using (public.can_configure(company_id)) with check (public.can_configure(company_id));

-- IC Supra: ligada, com CPAP, outros produtos (Varejo) e compras para empresas (Institucional).
insert into public.whatsapp_triage (company_id, enabled, intro, options)
select c.id, true,
       'Olá! Aqui é a ' || c.name || '. Para te atender mais rápido, escolha o assunto:',
       jsonb_build_array(
         jsonb_build_object('title', 'CPAP e apneia', 'pipeline_id', (select id from public.pipelines where company_id = c.id and key = 'cpap')),
         jsonb_build_object('title', 'Outros produtos', 'pipeline_id', (select id from public.pipelines where company_id = c.id and key = 'varejo')),
         jsonb_build_object('title', 'Compras p/ empresa', 'pipeline_id', (select id from public.pipelines where company_id = c.id and key = 'b2b'))
       )
from public.companies c
where c.slug = 'ic-supra'
on conflict (company_id) do nothing;
