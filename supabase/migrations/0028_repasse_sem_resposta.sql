-- =====================================================================
-- Orvya — Repasse automático de lead sem resposta (pedido de 06/11/2026).
--
-- reassign_minutes: {"<user_id>": 5} — se o vendedor não responder o cliente em N minutos
-- (contados da mensagem do cliente ou de quando o lead chegou para ele, o que for mais tarde),
-- o lead e a conversa passam para o próximo vendedor do rodízio do funil (ex.: Gilcélia → Renato
-- ou Gabriel, quem estiver disponível). Vale só para lead ainda não respondido pela equipe, no
-- horário de atendimento. A rotina roda a cada minuto (cron da Vercel).
-- Pode ser executado mais de uma vez.
-- =====================================================================

alter table public.lead_distribution
  add column if not exists reassign_minutes jsonb not null default '{}'::jsonb;

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
           (d.reassign_minutes ->> l.owner_id::text)::int as mins
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
      -- Ninguém da equipe respondeu desde que o lead chegou.
      and not exists (
        select 1 from public.messages m
        where m.conversation_id = c.id and m.direction = 'out' and m.sender = 'user' and m.created_at >= l.created_at
      )
  loop
    -- Próximo do rodízio que não seja o próprio vendedor (pula a vez dele, se cair nele).
    v_new := null;
    for v_try in 1..8 loop
      v_new := public.rotation_next(r.pipeline_id);
      exit when v_new is null or v_new <> r.owner_id;
    end loop;
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
