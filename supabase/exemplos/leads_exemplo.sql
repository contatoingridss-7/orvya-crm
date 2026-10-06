-- =====================================================================
-- Orvya — leads de EXEMPLO para testar funil, tarefas e painel.
-- Tudo fictício. Telefones com DDD 00 (não existe) para nunca coincidir com número real.
-- Para apagar tudo: supabase/exemplos/remover_exemplos.sql
--
-- Responsáveis: usa os usuários de teste da Fase 1, se existirem na empresa:
--   contatoingridss+gestor@gmail.com e contatoingridss+vendedor@gmail.com
-- Produtos de interesse: ligados pelo código do Net Use, se o produto estiver no catálogo.
-- =====================================================================

create or replace function pg_temp.owner_id(p_email text, p_company uuid)
returns uuid language sql as $$
  select p.id from public.profiles p
  where p.email = p_email
    and (p.is_platform_admin or exists (select 1 from public.memberships m where m.user_id = p.id and m.company_id = p_company))
$$;

create or replace function pg_temp.demo_lead(
  p_company text, p_pipeline text, p_stage text, p_name text, p_phone text, p_org text,
  p_type public.customer_type, p_temp public.lead_temperature, p_value numeric, p_source text,
  p_owner_email text, p_created_days int, p_contact_days int,
  p_custom jsonb default '{}'::jsonb, p_lost_reason text default null, p_closed_days int default null
) returns uuid language plpgsql as $$
declare
  v_company uuid; v_pipeline uuid; v_stage uuid; v_contact uuid; v_lead uuid;
begin
  select id into v_company from public.companies where slug = p_company;
  select id into v_pipeline from public.pipelines where company_id = v_company and key = p_pipeline;
  select id into v_stage from public.stages where pipeline_id = v_pipeline and key = p_stage;

  insert into public.contacts (company_id, name, phone_e164, org_name, customer_type, notes, created_at)
  values (v_company, p_name, p_phone, p_org, p_type, 'Exemplo Orvya — pode apagar', now() - make_interval(days => p_created_days))
  returning id into v_contact;

  insert into public.leads (company_id, contact_id, pipeline_id, stage_id, owner_id, value, temperature, source_id,
                            custom, lost_reason, closed_at, last_contact_at, created_at, score)
  values (v_company, v_contact, v_pipeline, v_stage,
          case when p_owner_email is null then null else pg_temp.owner_id(p_owner_email, v_company) end,
          p_value, p_temp,
          (select id from public.lead_sources where company_id = v_company and name = p_source),
          p_custom, p_lost_reason,
          case when p_closed_days is null then null else now() - make_interval(days => p_closed_days) end,
          now() - make_interval(days => p_contact_days),
          now() - make_interval(days => p_created_days),
          case p_temp when 'quente' then 78 when 'morno' then 52 else 25 end)
  returning id into v_lead;
  return v_lead;
end $$;

create or replace function pg_temp.demo_product(p_lead uuid, p_code text, p_mode text default 'venda', p_qty int default 1)
returns void language sql as $$
  insert into public.lead_products (company_id, lead_id, product_id, mode, quantity)
  select l.company_id, l.id, p.id, p_mode, p_qty
  from public.leads l join public.products p on p.company_id = l.company_id and p.code = p_code
  where l.id = p_lead
  on conflict do nothing;
$$;

create or replace function pg_temp.demo_note(p_lead uuid, p_body text, p_days int)
returns void language sql as $$
  insert into public.activities (company_id, lead_id, kind, body, created_at)
  select company_id, id, 'note', p_body, now() - make_interval(days => p_days) from public.leads where id = p_lead;
$$;

create or replace function pg_temp.demo_task(p_lead uuid, p_title text, p_due_days int)
returns void language sql as $$
  insert into public.tasks (company_id, lead_id, title, due_at, owner_id, origin)
  select company_id, id, p_title, now() + make_interval(days => p_due_days), owner_id, 'manual' from public.leads where id = p_lead;
$$;

do $$
declare
  g text := 'contatoingridss+gestor@gmail.com';
  v text := 'contatoingridss+vendedor@gmail.com';
  l uuid;
begin
  if exists (select 1 from public.contacts where notes = 'Exemplo Orvya — pode apagar') then
    raise exception 'Os leads de exemplo já foram criados. Rode remover_exemplos.sql antes de criar de novo.';
  end if;

  -- ---------------- IC Supra · Varejo ----------------
  l := pg_temp.demo_lead('ic-supra', 'varejo', 'novo', 'Maria do Socorro Lima', '+5500900000101', null, 'B2C', 'quente', 690, 'Meta Ads', null, 0, 0);
  perform pg_temp.demo_product(l, '10256');
  perform pg_temp.demo_note(l, 'Chegou pelo anúncio. Mãe teve alta e precisa de cadeira de rodas para esta semana.', 0);

  l := pg_temp.demo_lead('ic-supra', 'varejo', 'novo', 'Ana Beatriz Rocha', '+5500900000102', null, 'B2C', 'frio', 0, 'Site', null, 1, 1);

  l := pg_temp.demo_lead('ic-supra', 'varejo', 'qualificado', 'Francisco Alves', '+5500900000103', null, 'B2C', 'morno', 124.80, 'WhatsApp direto', v, 3, 2);
  perform pg_temp.demo_product(l, '414', 'venda', 2);
  perform pg_temp.demo_note(l, 'Quer duas muletas canadenses, uma para o filho. Perguntou sobre entrega no Dirceu.', 2);

  l := pg_temp.demo_lead('ic-supra', 'varejo', 'orcamento', 'Antônia Carvalho', '+5500900000104', null, 'B2C', 'quente', 352.47, 'Google Ads', v, 6, 4,
                         '{"entrega":"Entrega em Teresina"}');
  perform pg_temp.demo_product(l, '4832');
  perform pg_temp.demo_task(l, 'Cobrar retorno do orçamento', -1);

  l := pg_temp.demo_lead('ic-supra', 'varejo', 'negociacao', 'José Ribamar Sousa', '+5500900000105', null, 'B2C', 'morno', 690, 'Indicação', g, 9, 8,
                         '{"entrega":"Retira na loja"}');
  perform pg_temp.demo_product(l, '10256');
  perform pg_temp.demo_note(l, 'Pediu desconto à vista. Ficou de responder depois de falar com a família.', 8);

  l := pg_temp.demo_lead('ic-supra', 'varejo', 'ganho', 'Raimunda Pereira', '+5500900000106', null, 'B2C', 'quente', 156, 'Loja física', v, 12, 5,
                         '{}', null, 5);
  l := pg_temp.demo_lead('ic-supra', 'varejo', 'perdido', 'Pedro Henrique Costa', '+5500900000107', null, 'B2C', 'frio', 258.09, 'Meta Ads', v, 20, 10,
                         '{}', 'Preço acima do esperado', 10);

  -- ---------------- IC Supra · Institucional ----------------
  l := pg_temp.demo_lead('ic-supra', 'b2b', 'prospeccao', 'Dra. Helena Martins', '+5500900000201', 'Clínica São Lucas (exemplo)', 'B2B', 'morno', 0, 'Indicação', g, 4, 4,
                         '{"recorrencia":"Não informado"}');
  l := pg_temp.demo_lead('ic-supra', 'b2b', 'cotacao', 'Marcos Teixeira', '+5500900000202', 'Home Care Vida (exemplo)', 'B2B', 'quente', 4800, 'Google Ads', g, 10, 2,
                         '{"comprador":"Marcos Teixeira","recorrencia":"Mensal"}');
  perform pg_temp.demo_product(l, '10237', 'venda', 3000);
  perform pg_temp.demo_task(l, 'Confirmar se a cotação foi recebida', 1);

  l := pg_temp.demo_lead('ic-supra', 'b2b', 'negociacao', 'Lúcia Fernandes', '+5500900000203', 'Hospital Santa Clara (exemplo)', 'B2B', 'quente', 12500, 'Indicação', g, 25, 9,
                         '{"recorrencia":"Trimestral"}');
  perform pg_temp.demo_note(l, 'Licitação interna. Pediram prazo de 28 dias para pagamento.', 9);

  -- ---------------- LocPress · Venda ----------------
  l := pg_temp.demo_lead('locpress', 'venda', 'novo', 'Carlos Eduardo Nunes', '+5500900000301', null, 'B2C', 'quente', 200, 'Meta Ads', null, 0, 0);
  perform pg_temp.demo_product(l, '609');
  l := pg_temp.demo_lead('locpress', 'venda', 'orcamento', 'Fátima Gomes', '+5500900000302', null, 'B2C', 'morno', 150, 'Site', v, 5, 3);
  perform pg_temp.demo_product(l, '727');

  -- ---------------- LocPress · Locação ----------------
  l := pg_temp.demo_lead('locpress', 'locacao', 'qualificado', 'Bartolomeu Ferreira', '+5500900000401', null, 'B2C', 'quente', 0, 'Hospital parceiro', g, 2, 1,
                         '{"endereco":"Rua Exemplo, 100 — Bairro Exemplo, Teresina"}');
  perform pg_temp.demo_product(l, '301', 'locacao');
  perform pg_temp.demo_note(l, 'Alta prevista para sexta. Família quer CPAP alugado por 3 meses. Valor a negociar com a equipe.', 1);

  l := pg_temp.demo_lead('locpress', 'locacao', 'entrega', 'Joana Batista', '+5500900000402', null, 'B2C', 'morno', 420, 'Indicação médica', g, 8, 1);
  l := pg_temp.demo_lead('locpress', 'locacao', 'ativo', 'Carla Mendes', '+5500900000403', null, 'B2C', 'quente', 1260, 'Indicação médica', g, 40, 20,
                         '{}', null, 20);

  -- ---------------- LocPress · CPAP e home care ----------------
  l := pg_temp.demo_lead('locpress', 'homecare', 'avaliacao', 'Sebastião Rocha', '+5500900000501', null, 'B2C', 'quente', 0, 'Indicação médica', g, 3, 2,
                         '{"receita":"Recebida","medico":"Dr. Exemplo","mascara":"A definir","modalidade":"Locação"}');
  l := pg_temp.demo_lead('locpress', 'homecare', 'teste', 'Teresa Lima', '+5500900000502', null, 'B2C', 'morno', 0, 'Site', g, 9, 6,
                         '{"receita":"Pendente","modalidade":"A definir"}');
end $$;
