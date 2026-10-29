-- =====================================================================
-- Orvya — coexistência (mesmo número no app WhatsApp Business e na API oficial).
--
-- O número é conectado pelo cadastro integrado da Meta (Embedded Signup), sem chip novo.
-- Depois de conectar, há 24 horas para pedir a sincronização de contatos e histórico
-- (uma vez cada); sync_requested_at registra o pedido.
-- Pode ser executado mais de uma vez.
-- =====================================================================

alter table public.whatsapp_numbers
  add column if not exists coexistence       boolean not null default false,
  add column if not exists sync_requested_at timestamptz;
