-- =====================================================================
-- Orvya — dados iniciais
-- Preços ficam NULL de propósito: o gestor preenche a tabela aprovada.
-- Produto sem preço = IA informa que vai confirmar com a equipe e passa para humano.
-- =====================================================================

create or replace function pg_temp.seed_pipeline(
  p_company uuid, p_key text, p_name text, p_hint text, p_pos int,
  p_stage_keys text[], p_stage_names text[], p_stage_kinds text[]
) returns uuid language plpgsql as $$
declare v_pipeline uuid; i int;
begin
  insert into public.pipelines (company_id, key, name, hint, position)
  values (p_company, p_key, p_name, p_hint, p_pos)
  returning id into v_pipeline;

  for i in 1 .. array_length(p_stage_keys, 1) loop
    insert into public.stages (company_id, pipeline_id, key, name, kind, position)
    values (p_company, v_pipeline, p_stage_keys[i], p_stage_names[i], p_stage_kinds[i]::public.stage_kind, i);
  end loop;
  return v_pipeline;
end $$;

create or replace function pg_temp.stage(p_pipeline uuid, p_key text)
returns uuid language sql as $$
  select id from public.stages where pipeline_id = p_pipeline and key = p_key;
$$;

do $$
declare
  c_supra uuid; c_loc uuid;
  p_varejo uuid; p_b2b uuid;
  p_venda uuid; p_locacao uuid; p_homecare uuid;
begin
  -- Empresas -----------------------------------------------------------
  insert into public.companies (slug, name, short_name, segment)
  values ('ic-supra', 'IC Supra Hospitalar', 'IC Supra', 'Produtos hospitalares e ortopédicos')
  returning id into c_supra;

  insert into public.companies (slug, name, short_name, segment)
  values ('locpress', 'LocPress Saúde', 'LocPress', 'Venda e locação de equipamentos médicos e hospitalares, CPAP e home care')
  returning id into c_loc;

  -- Funis IC Supra -----------------------------------------------------
  p_varejo := pg_temp.seed_pipeline(c_supra, 'varejo', 'Varejo', 'Pacientes e famílias', 1,
    array['novo','qualificado','orcamento','negociacao','ganho','perdido'],
    array['Novo contato','Qualificado','Orçamento enviado','Negociação','Venda fechada','Perdido'],
    array['open','open','open','open','won','lost']);

  p_b2b := pg_temp.seed_pipeline(c_supra, 'b2b', 'Institucional', 'Clínicas, hospitais e home cares', 2,
    array['prospeccao','contato','cotacao','negociacao','ganho','perdido'],
    array['Prospecção','Primeiro contato','Cotação enviada','Negociação','Pedido fechado','Perdido'],
    array['open','open','open','open','won','lost']);

  -- Funis LocPress -----------------------------------------------------
  p_venda := pg_temp.seed_pipeline(c_loc, 'venda', 'Venda', 'Equipamentos médicos e hospitalares', 1,
    array['novo','qualificado','orcamento','negociacao','ganho','perdido'],
    array['Novo contato','Qualificado','Orçamento enviado','Negociação','Vendido','Perdido'],
    array['open','open','open','open','won','lost']);

  p_locacao := pg_temp.seed_pipeline(c_loc, 'locacao', 'Locação', 'Aluguel de equipamentos', 2,
    array['novo','qualificado','documentacao','entrega','ativo','perdido'],
    array['Novo contato','Qualificado','Documentação','Entrega agendada','Em locação','Perdido'],
    array['open','open','open','open','won','lost']);

  p_homecare := pg_temp.seed_pipeline(c_loc, 'homecare', 'CPAP e home care', 'Terapia do sono e cuidados em casa', 3,
    array['novo','avaliacao','teste','proposta','ganho','perdido'],
    array['Novo contato','Receita e avaliação','Teste de adaptação','Proposta','Fechado','Perdido'],
    array['open','open','open','open','won','lost']);

  -- Campos personalizados ---------------------------------------------
  insert into public.custom_fields (company_id, pipeline_id, key, label, field_type, options, position, full_width) values
    (c_supra, p_varejo, 'entrega', 'Entrega', 'select', array['A definir','Retira na loja','Entrega em Teresina','Envio para o interior'], 1, false),
    (c_supra, p_b2b, 'cnpj', 'CNPJ', 'text', null, 1, false),
    (c_supra, p_b2b, 'comprador', 'Comprador responsável', 'text', null, 2, false),
    (c_supra, p_b2b, 'recorrencia', 'Compra recorrente', 'select', array['Não informado','Mensal','Trimestral','Pontual'], 3, false),
    (c_loc, p_venda, 'entrega', 'Entrega', 'select', array['A definir','Retira na loja','Entrega e instalação','Envio para o interior'], 1, false),
    (c_loc, p_venda, 'cnpj', 'CNPJ (se empresa)', 'text', null, 2, false),
    (c_loc, p_locacao, 'endereco', 'Endereço de entrega', 'text', null, 1, true),
    (c_loc, p_homecare, 'receita', 'Receita médica', 'select', array['Pendente','Recebida','Não precisa'], 1, false),
    (c_loc, p_homecare, 'medico', 'Médico solicitante', 'text', null, 2, false),
    (c_loc, p_homecare, 'pressao', 'Pressão prescrita (cmH₂O)', 'text', null, 3, false),
    (c_loc, p_homecare, 'mascara', 'Máscara', 'select', array['A definir','Nasal','Oronasal','Almofada nasal'], 4, false),
    (c_loc, p_homecare, 'modalidade', 'Modalidade', 'select', array['A definir','Compra','Locação'], 5, false);
  -- Dados do contrato de locação ficam em rental_contracts (não em campo personalizado).

  -- Origens ------------------------------------------------------------
  insert into public.lead_sources (company_id, name, position) values
    (c_supra, 'Meta Ads', 1), (c_supra, 'Google Ads', 2), (c_supra, 'Instagram orgânico', 3),
    (c_supra, 'Site', 4), (c_supra, 'WhatsApp direto', 5), (c_supra, 'Indicação', 6), (c_supra, 'Loja física', 7),
    (c_loc, 'Meta Ads', 1), (c_loc, 'Google Ads', 2), (c_loc, 'Instagram orgânico', 3),
    (c_loc, 'Site', 4), (c_loc, 'WhatsApp direto', 5), (c_loc, 'Indicação médica', 6), (c_loc, 'Hospital parceiro', 7);

  -- Motivos de perda ----------------------------------------------------
  insert into public.lost_reasons (company_id, name, position) values
    (c_supra, 'Preço acima do esperado', 1), (c_supra, 'Comprou na concorrência', 2), (c_supra, 'Sem estoque', 3),
    (c_supra, 'Não respondeu mais', 4), (c_supra, 'Só pesquisando', 5),
    (c_loc, 'Preço acima do esperado', 1), (c_loc, 'Fechou com concorrente', 2), (c_loc, 'Sem equipamento disponível', 3),
    (c_loc, 'Paciente internado ou faleceu', 4), (c_loc, 'Não respondeu mais', 5);

  -- Automações ----------------------------------------------------------
  insert into public.automation_rules (company_id, pipeline_id, stage_id, task_title, due_in_days, enabled) values
    (c_supra, p_varejo, pg_temp.stage(p_varejo, 'orcamento'), 'Cobrar retorno do orçamento', 2, true),
    (c_supra, p_varejo, pg_temp.stage(p_varejo, 'ganho'), 'Pós-venda: perguntar se o produto atendeu', 7, true),
    (c_supra, p_b2b, pg_temp.stage(p_b2b, 'cotacao'), 'Confirmar se a cotação foi recebida', 1, true),
    (c_supra, p_b2b, pg_temp.stage(p_b2b, 'ganho'), 'Agendar a próxima reposição com o comprador', 25, true),
    (c_loc, p_venda, pg_temp.stage(p_venda, 'orcamento'), 'Cobrar retorno do orçamento', 2, true),
    (c_loc, p_venda, pg_temp.stage(p_venda, 'ganho'), 'Agendar entrega e instalação', 1, true),
    (c_loc, p_locacao, pg_temp.stage(p_locacao, 'documentacao'), 'Conferir documentos e contrato assinado', 1, true),
    (c_loc, p_locacao, pg_temp.stage(p_locacao, 'entrega'), 'Confirmar endereço e horário da entrega', 0, true),
    (c_loc, p_locacao, pg_temp.stage(p_locacao, 'ativo'), 'Ligar para checar a adaptação ao equipamento', 3, true),
    (c_loc, p_homecare, pg_temp.stage(p_homecare, 'teste'), 'Avaliar a adaptação ao CPAP com o paciente', 5, true),
    (c_loc, p_homecare, pg_temp.stage(p_homecare, 'proposta'), 'Retornar a proposta de CPAP', 2, false);

  -- Números de WhatsApp (slots vazios; o admin conecta) -----------------
  insert into public.whatsapp_numbers (company_id, slot, label, default_pipeline_id) values
    (c_supra, 1, 'Atendimento e vendas', p_varejo),
    (c_supra, 2, 'Institucional', p_b2b),
    (c_loc, 1, 'Locação e CPAP', p_locacao),
    (c_loc, 2, 'Venda de equipamentos', p_venda);

  -- Agente de IA (desligado até revisar o prompt) -----------------------
  insert into public.ai_settings (company_id, enabled) values (c_supra, false), (c_loc, false);

  -- Catálogo IC Supra (itens da aprovação de maio/2026; estoque informado; preços a preencher)
  insert into public.products (company_id, code, name, category, stock, ai_notes) values
    (c_supra, '414',  'Muleta canadense preta ALO', 'Mobilidade', 16, null),
    (c_supra, '417',  'Muleta canadense articulada preta ALO', 'Mobilidade', 10, null),
    (c_supra, '80',   'Muleta universal axilar Dellamed', 'Mobilidade', 8, 'Regulagem de altura.'),
    (c_supra, '6407', 'Muleta canadense azul ALO', 'Mobilidade', 4, null),
    (c_supra, '7319', 'Ponteira 22 mm cinza para muleta axilar Dellamed', 'Acessórios', 21, null),
    (c_supra, '8104', 'Ponteira 5/8 ALO', 'Acessórios', 11, null),
    (c_supra, '9866', 'Ponteira para muleta canadense fixa Hydrolight', 'Acessórios', 8, null),
    (c_supra, '7367', 'Ponteira 28 mm para andador D10 Dellamed', 'Acessórios', 14, null),
    (c_supra, '8094', 'Órtese Comfort Air sem polegar esquerda preta P', 'Órteses', 4, null),
    (c_supra, '7682', 'Tala dinâmica para dedo (gafanhoto) PP GLC', 'Órteses', 4, null),
    (c_supra, '7683', 'Tala PVC para extensão de dedos GG GLC', 'Órteses', 4, null),
    (c_supra, '3319', 'Kit de tala em EVA 4 peças (PP, P, M, G) Resgate', 'Imobilização', 6, null),
    (c_supra, '9897', 'Papagaio 1,4 L plástico com tampa Cellpus', 'Cuidados', 34, null),
    (c_supra, '8029', 'Rolo de posicionamento espuma e courvim M', 'Reabilitação', 4, null),
    (c_supra, '8030', 'Rolo de posicionamento espuma e courvim P', 'Reabilitação', 4, null),
    (c_supra, '9924', 'Prancha de polietileno com cinto adulto Resgate', 'Resgate', 4, null);

  -- Catálogo LocPress (itens de exemplo; o gestor ajusta nomes, preços e estoque)
  insert into public.products (company_id, name, category, stock) values
    (c_loc, 'CPAP automático com umidificador', 'Sono', 0),
    (c_loc, 'BiPAP', 'Sono', 0),
    (c_loc, 'Máscara nasal para CPAP', 'Sono', 0),
    (c_loc, 'Concentrador de oxigênio 5 L', 'Respiratório', 0),
    (c_loc, 'Aspirador de secreção portátil', 'Respiratório', 0),
    (c_loc, 'Nebulizador', 'Respiratório', 0),
    (c_loc, 'Monitor multiparamétrico', 'Monitoramento', 0),
    (c_loc, 'Oxímetro de pulso', 'Monitoramento', 0),
    (c_loc, 'Cama hospitalar elétrica 3 movimentos', 'Camas e mobiliário', 0),
    (c_loc, 'Cama hospitalar manual 2 manivelas', 'Camas e mobiliário', 0),
    (c_loc, 'Colchão pneumático com compressor', 'Camas e mobiliário', 0),
    (c_loc, 'Cadeira de rodas dobrável', 'Mobilidade', 0),
    (c_loc, 'Cadeira de banho com rodas', 'Mobilidade', 0);
end $$;

-- ---------------------------------------------------------------------
-- Depois de criar sua conta no Supabase Auth, torne-se administrador:
--   update public.profiles set is_platform_admin = true where email = 'seu@email.com';
-- ---------------------------------------------------------------------
