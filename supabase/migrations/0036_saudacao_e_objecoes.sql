-- =====================================================================
-- Orvya — Saudação com botões, finalização e quebra de objeções (pedido de 06/11/2026).
--
-- quick_replies.with_menu: a resposta vai com os botões de assunto da triagem (whatsapp_triage)
-- da empresa; o botão tocado leva o lead ao funil certo (mesma regra da triagem automática).
-- Cadastra /saudacao, /finalizacao e /obj-* nas duas empresas ({empresa} vira o nome da empresa;
-- {nome} e {vendedor} são trocados no envio).
-- Pode ser executado mais de uma vez.
-- =====================================================================

alter table public.quick_replies
  add column if not exists with_menu boolean not null default false;

with r(shortcut, body, with_menu) as (
  values
  ('saudacao', $t$Olá, {nome}! 😊 Eu sou {vendedor}, seja bem-vindo(a) à *{empresa}*.
Me conta: qual produto ou serviço você procura hoje? É só tocar em uma das opções abaixo.$t$, true),

  ('finalizacao', $t$Foi um prazer te atender, {nome}! 💙
Qualquer dúvida sobre o produto, a entrega ou o uso, é só chamar aqui neste número.
Eu sou {vendedor}, da *{empresa}*. Conte com a gente!$t$, false),

  ('obj-preco', $t$Entendo, {nome}! Preço é importante mesmo. 😊
Aqui você leva com *garantia de fábrica*, nota fiscal e a nossa orientação para usar do jeito certo.
No cartão, parcelamos; à vista (PIX ou dinheiro), o valor fica menor.
Quer que eu te mostre as condições para o seu caso?$t$, false),

  ('obj-pensar', $t$Claro, {nome}, fique à vontade para pensar! 😊
Ficou alguma dúvida que eu possa esclarecer agora? Às vezes um detalhe faz toda a diferença na escolha.
Se quiser, eu confirmo a disponibilidade para você não ficar sem quando decidir.$t$, false),

  ('obj-pesquisar', $t$Pode pesquisar sim, {nome}! 😊 Só lembrando o que você tem com a *{empresa}*:
✅ Loja aqui em Teresina, com atendimento de perto
✅ Entrega rápida e orientação no uso
✅ Garantia e nota fiscal
Se encontrar uma condição diferente, me mostra que eu vejo o que consigo fazer.$t$, false),

  ('obj-entrega', $t${nome}, fazemos entrega em Teresina e região. 🚚
Me passa o endereço completo com bairro que eu confirmo o prazo e o valor da entrega para você.$t$, false),

  ('obj-confianca', $t${nome}, pode ficar tranquilo(a)! A *{empresa}* é loja física aqui em Teresina, e você pode nos visitar quando quiser. 😊
Todos os produtos têm nota fiscal e garantia, e a gente acompanha você depois da compra também.$t$, false),

  ('obj-parcelamento', $t$Sobre o pagamento, {nome}:
💳 Parcelamos no cartão de crédito.
💰 À vista (PIX ou dinheiro) o valor é menor.
Não trabalhamos com link de pagamento. Quer que eu te passe o valor nas duas formas?$t$, false)
)
insert into public.quick_replies (company_id, shortcut, body, with_menu)
select c.id, r.shortcut, replace(r.body, '{empresa}', c.name), r.with_menu
from public.companies c cross join r
where c.slug in ('ic-supra', 'locpress')
on conflict (company_id, shortcut) do update
  set body = excluded.body, with_menu = excluded.with_menu;
