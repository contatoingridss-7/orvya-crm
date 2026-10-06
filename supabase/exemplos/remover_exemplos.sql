-- =====================================================================
-- Orvya — apaga TODOS os dados de exemplo criados por leads_exemplo.sql.
-- Apagar o contato apaga junto os leads, tarefas, histórico, produtos de interesse
-- e conversas ligados a ele. Nada além dos contatos marcados como exemplo é tocado.
-- =====================================================================
delete from public.contacts
where notes = 'Exemplo Orvya — pode apagar'
returning name;
