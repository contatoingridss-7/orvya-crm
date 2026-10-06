-- =====================================================================
-- Orvya — WhatsApp (Fase 3a): recebimento pelo webhook.
-- Pode ser executado mais de uma vez.
-- =====================================================================

-- De onde veio a mensagem:
--   orvya     = enviada/recebida pela API (Orvya)
--   celular   = enviada pelo app WhatsApp Business no celular (coexistência, eco da Meta)
--   historico = importada do histórico do app na conexão (coexistência)
alter table public.messages
  add column if not exists source         text not null default 'orvya' check (source in ('orvya', 'celular', 'historico')),
  -- Hora real da mensagem (timestamp da Meta). created_at é quando o Orvya gravou.
  add column if not exists sent_at        timestamptz not null default now(),
  -- Mensagem citada na resposta (context.id da Meta)
  add column if not exists reply_to_wa_id text;

create index if not exists messages_thread_sent_idx on public.messages (conversation_id, sent_at);

-- Registra a chegada de mensagem do cliente na conversa, de forma atômica.
-- Chamado só pelo servidor (service_role) depois de gravar a mensagem.
create or replace function public.conversation_inbound(p_conversation uuid, p_at timestamptz)
returns void language sql security invoker set search_path = '' as $$
  update public.conversations
  set unread_count    = unread_count + 1,
      last_inbound_at = greatest(coalesce(last_inbound_at, p_at), p_at),
      last_message_at = greatest(coalesce(last_message_at, p_at), p_at)
  where id = p_conversation;
$$;

revoke execute on function public.conversation_inbound(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.conversation_inbound(uuid, timestamptz) to service_role;
