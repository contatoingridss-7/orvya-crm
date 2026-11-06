-- =====================================================================
-- Orvya — Resposta rápida com imagem (pedido de 06/11/2026).
--
-- quick_replies.material_ids: materiais (Respostas e materiais) que vão junto com a resposta.
-- Uma imagem só: vai a imagem com o texto como legenda. Várias: vai o texto e depois as imagens.
-- Já liga as respostas das cadeiras de rodas aos cartões de cada modelo.
-- Pode ser executado mais de uma vez.
-- =====================================================================

alter table public.quick_replies
  add column if not exists material_ids uuid[] not null default '{}';

-- Respostas das cadeiras → cartões (pelo título do material, em cada empresa).
with links(shortcut, titles) as (
  values
    ('cadeira-simples',    array['Cadeira de rodas Simples ProLife (até 90 kg)']),
    ('cadeira-d90',        array['Cadeira de transporte D90 Dellamed (até 100 kg)']),
    ('cadeira-pratica',    array['Cadeira de rodas Prática ProLife com elevação de pernas (até 100 kg)']),
    ('cadeira-d100-pop',   array['Cadeira de rodas D100 Pop Dellamed (até 110 kg)']),
    ('cadeira-d100',       array['Cadeira de rodas D100 Dellamed (até 120 kg)']),
    ('cadeira-d600',       array['Cadeira de rodas D600 T48 Dellamed (até 120 kg)']),
    ('cadeira-d700',       array['Cadeira de rodas reclinável D700 Dellamed (até 130 kg)']),
    ('cadeiras-ate-100kg', array['Cadeira de rodas Simples ProLife (até 90 kg)', 'Cadeira de transporte D90 Dellamed (até 100 kg)', 'Cadeira de rodas Prática ProLife com elevação de pernas (até 100 kg)']),
    ('cadeiras-ate-120kg', array['Cadeira de rodas D100 Pop Dellamed (até 110 kg)', 'Cadeira de rodas D100 Dellamed (até 120 kg)', 'Cadeira de rodas D600 T48 Dellamed (até 120 kg)']),
    ('cadeiras-ate-130kg', array['Cadeira de rodas reclinável D700 Dellamed (até 130 kg)'])
)
update public.quick_replies q
set material_ids = coalesce((
  select array_agg(m.id order by array_position(l.titles, m.title))
  from public.sales_materials m
  where m.company_id = q.company_id and m.title = any (l.titles)
), '{}')
from links l
where q.shortcut = l.shortcut;
