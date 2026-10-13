-- =====================================================================
-- Orvya — tela Conversas (Fase 3b)
-- Prévia da última mensagem na própria conversa, para a lista não precisar
-- buscar as mensagens de todas as conversas. Pode ser executado mais de uma vez.
-- =====================================================================

alter table public.conversations
  add column if not exists last_preview   text,
  add column if not exists last_direction public.msg_direction;

-- Preenche as conversas que já existem com a última mensagem de cada uma.
update public.conversations c
set last_preview = left(m.body, 160), last_direction = m.direction
from (
  select distinct on (conversation_id) conversation_id, body, direction
  from public.messages
  order by conversation_id, sent_at desc
) m
where m.conversation_id = c.id and c.last_preview is null;

-- Chegada de mensagem do cliente (substitui a versão da 0006): também guarda a prévia.
create or replace function public.conversation_inbound(p_conversation uuid, p_at timestamptz, p_preview text default null)
returns void language sql security invoker set search_path = '' as $$
  update public.conversations
  set unread_count    = unread_count + 1,
      last_inbound_at = greatest(coalesce(last_inbound_at, p_at), p_at),
      last_message_at = greatest(coalesce(last_message_at, p_at), p_at),
      last_preview    = case when p_at >= coalesce(last_message_at, p_at) then left(p_preview, 160) else last_preview end,
      last_direction  = case when p_at >= coalesce(last_message_at, p_at) then 'in'::public.msg_direction else last_direction end
  where id = p_conversation;
$$;

drop function if exists public.conversation_inbound(uuid, timestamptz);
revoke execute on function public.conversation_inbound(uuid, timestamptz, text) from public, anon, authenticated;
grant execute on function public.conversation_inbound(uuid, timestamptz, text) to service_role;

-- Abrir a conversa zera o contador de não lidas. Quem pode ver a conversa pode
-- marcá-la como lida (inclusive o vendedor numa conversa da fila, que ainda não é dele).
create or replace function public.mark_conversation_read(p_conversation uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.conversations c
    where c.id = p_conversation and public.can_see_owned(c.company_id, c.assigned_to)
  ) then
    raise exception 'Sem acesso a esta conversa';
  end if;
  update public.conversations set unread_count = 0 where id = p_conversation;
end $$;

revoke execute on function public.mark_conversation_read(uuid) from public, anon;
grant execute on function public.mark_conversation_read(uuid) to authenticated;
