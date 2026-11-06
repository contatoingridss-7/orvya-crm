-- =====================================================================
-- Orvya — Áudio em "Respostas e materiais" (pedido de 06/11/2026).
--
-- O áudio é convertido para mensagem de voz do WhatsApp (OGG/Opus) antes de subir;
-- o bucket sales-materials passa a aceitar audio/ogg. Pode ser executado mais de uma vez.
-- =====================================================================

update storage.buckets
set allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png', 'audio/ogg']
where id = 'sales-materials';
