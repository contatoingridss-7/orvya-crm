-- =====================================================================
-- Orvya — Nomes dos campos dos modelos importados da Meta.
--
-- Modelos trazidos pelo "Atualizar status" chegam com campos genéricos (var1, var2...).
-- Com o nome certo, a conversa preenche sozinha o primeiro nome do cliente ({{1}} = nome),
-- o de quem envia ({{2}} = vendedor) e o produto ({{3}} = produto).
-- Só altera os 4 modelos padrão que ainda estão com var1. Pode ser executado mais de uma vez.
-- =====================================================================

update public.message_templates
set variables = array['nome', 'vendedor', 'produto']
where name in ('retomada_orcamento', 'encerramento_atendimento', 'pos_venda')
  and cardinality(variables) = 3 and variables[1] = 'var1';

update public.message_templates
set variables = array['nome', 'data_da_entrega']
where name = 'confirmacao_entrega'
  and cardinality(variables) = 2 and variables[1] = 'var1';
