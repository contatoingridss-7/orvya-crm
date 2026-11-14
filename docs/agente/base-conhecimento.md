# Base de conhecimento do agente de IA

Fonte: definições da Ingrid (gestão) entre 06 e 12/11/2026. O agente consulta esta base, o catálogo (estoque) e as respostas rápidas. Nada aqui inclui dados de clientes.

**Situação em 12/11/2026:** o agente está desligado nas duas empresas (decisão de custo) e o código dele ainda não foi construído. As instruções por empresa já estão gravadas (`ai_settings.system_prompt`) e descritas em `docs/AGENTE_IA.md`, seção 6, prontas para quando ele for ligado.

## Regras gerais (valem para as duas empresas)

- **Preço:** o agente **não passa valores**. Na 1ª pergunta de preço, agrega valor (benefícios, opções, triagem). Na **2ª pergunta** de preço, aciona o **"Precisa de mim"** do vendedor da vez no funil, que assume com valor, frete, endereço e pagamento.
- **Estoque:** só oferece produto com estoque > 0 no catálogo (relatório de estoque do Net Use). IC Supra: relatório de 04/11/2026. LocPress: relatório de 11/11/2026.
- **Localização:** a equipe envia a localização da loja pelo Anexar → Localização (WhatsApp: cartão com mapa). O agente informa o endereço por texto.
- **Fechamento:** quando o cliente quer pagar, passar endereço ou calcular frete, passa para o vendedor com um resumo.
- **Garantia:** varia bastante por produto e fabricante. O agente diz que **todos os produtos têm garantia**, que o prazo depende do produto e que o vendedor confirma.
- **Nunca:** diagnosticar, indicar dosagem ou parâmetro clínico, prometer prazo de entrega, oferecer desconto, inventar condição comercial.
- **Saúde (LGPD):** receita, diagnóstico e condição do paciente só circulam no Orvya, na Meta e na Anthropic.

## IC Supra Hospitalar

- Razão social: IC L Lopes Mendes Ltda · CNPJ 63.980.482/0001-03
- Endereço: R. Coelho de Resende, 412, Centro (Sul), Teresina (PI), esquina com a Rua Olavo Bilac, atrás da Otorrinos. Estacionamento ao lado. · *falta: link do Maps*
- Telefone: (86) 9977-5120 (*confirmar*)
- Horário: segunda a sexta, 8h às 18h; sábado, 8h às 11h. Não fecha para almoço.
- Entrega: via aplicativo (Uber / 99). O vendedor pede endereço, observação (casa, bloco, setor, ponto comercial), nome, telefone e forma de pagamento (PIX ou transferência).
- Pagamento: não trabalha com link de pagamento. PIX ou transferência; na entrega, PIX ou dinheiro. Cartão na entrega para compras a partir de R$ 500.
- Parcelamento no cartão (tabela da loja): acima de R$ 100 em 2x · R$ 180 em 3x · R$ 400 em 4x · R$ 900 em 5x · R$ 1.800 em 6x · R$ 5.000 em 8x · R$ 6.000 em 10x.
- Fisioterapeuta (Thays): segunda a sexta, 8h–12h e 14h–18h; sábado, 8h–11h. Adaptação e ajuste de CPAP sem custo adicional.
- Funis: Varejo (rodízio Renato, Gabriel, Gilcélia), CPAP (Thays), Institucional (compras de empresas).
- Respostas rápidas da loja: `/saudacao` (com botões de assunto), `/endereco`, `/horario`, `/entrega`.
- Catálogo: 438 produtos ativos, 329 com estoque; nenhum com preço de venda cadastrado.
- *Falta: ver "O que falta" no fim deste documento.*

## LocPress Saúde

- Razão social: Soares e Mendes Ltda · CNPJ 49.929.048/0001-78
- Endereço: Av. Elias João Tajra, 1825, Teresina (PI) · *falta: ponto de referência, link do Maps*
- Telefones: (86) 3029-8556 · (86) 99446-3768
- Horário: segunda a sexta, 8h às 18h; sábado, 8h às 11h
- Pagamento: cartão a partir de R$ 100, em até 10x sem juros (o número de parcelas é combinado caso a caso); à vista em PIX ou dinheiro; sem link de pagamento.
- Funis: rodízio igual entre Thays, Isabela e Deusdeth em Venda, Locação e CPAP e home care (não há especialista de CPAP na LocPress).
- **IC e LocPress são separadas:** nada da IC (produtos, preços, materiais) vale para a LocPress, e vice-versa.
- Produtos com cartão e texto (formato do Deusdeth): cadeiras 301P CDS, D100, D400, D600, D700, D800 motorizada, Alumínio Premium Hidrolight; camas Pilati Prime Care, Steel dobrável e Steel 3 movimentos.
- Produtos que mais vendem (curva ABC, maio/2026): camas (Prime Care, Evolution motorizada, Fawler 2 movimentos), CPAP (S10 AutoSet 4G, DreamStation Auto, Sleeplive LT), máscaras (Wisp, nasal com apoio de testa, AirFit P30i), oxigênio medicinal (cilindro) e concentrador Everflo, colchão anti-escaras, cadeiras (D400, D55).

### Locação (LocPress)
- Documentos: identidade, CPF e comprovante de residência atualizado no nome do locatário.
- Pagamento da locação: no ato, à vista (PIX, débito, dinheiro ou crédito à vista); não parcela.
- Entrega: equipamento limpo, higienizado e revisado, com orientação de uso.
- **Cadeira de rodas:** sem prazo mínimo de locação — **confirmar com o vendedor**. (Atenção: a resposta rápida /aluguel-cadeira fala em "menor pacote 10 dias"; prevalece a confirmação do vendedor.)
- **Taxa de higienização:** cobrada na manutenção preventiva.
- **Taxa de análise:** cobrada para a manutenção corretiva.
- **Devolução com dano ou avaria:** a empresa faz o orçamento do reparo e o valor é cobrado do cliente, conforme o contrato de locação.
- Valores das taxas: o agente não informa; o vendedor confirma.
- Catálogo: 624 produtos ativos, 580 com estoque (relatório do Net Use de 11/11/2026); 26 itens de locação; nenhum com preço cadastrado.
- *Falta: ver "O que falta" no fim deste documento.*

## O que falta (levantado em 12/11/2026)

### Para ligar o agente
- Decisão de ligar (hoje desligado por custo) e a chave da Anthropic no servidor (nenhuma configurada).
- Construir o agente no código: hoje existem só a especificação (`docs/AGENTE_IA.md`) e as instruções por empresa.

### IC Supra
- Link do Google Maps da loja (ou cadastrar o local em Anexar → Localização → Salvar para a equipe).
- Telefone da loja: confirmar o (86) 9977-5120.
- Entrega: bairros e cidades atendidos, prazo e como é cobrado o frete do aplicativo.
- Envio para o interior: se faz e como.
- Troca e devolução: prazo e condições.
- Garantia: prazo por linha de produto (hoje o agente só diz que tem e que o vendedor confirma).

### LocPress
- Ponto de referência e link do Google Maps (ou cadastrar o local em Anexar → Localização).
- Entrega e retirada: área atendida, prazo e taxa, na venda e na locação.
- Pagamento na entrega: se aceita cartão e a partir de qual valor.
- Locação: valores por equipamento e período, prazo mínimo (a resposta `/aluguel-cadeira` fala em 10 dias e a regra atual diz "sem prazo mínimo") e valores das taxas de higienização e de análise.
- CPAP: condições do teste de adaptação, se houver.
- Troca, devolução e garantia na venda.
- Net Use: 63 itens estão com estoque negativo no relatório e entraram como zero no Orvya (por exemplo BiPAP AVAPS de locação, cilindro de 7 m³, cilindro de 1 m³, concentrador Yuwell de locação, bomba de infusão). Enquanto o saldo não for acertado no Net Use, o agente não oferece esses itens.

### Catálogo (as duas empresas)
- Preço de venda: nenhum produto tem preço cadastrado. Não impede o agente, porque ele não informa valores, mas o catálogo não serve de consulta de preço para a equipe.
- Fotos: 7 produtos com foto na IC Supra e nenhum na LocPress (os cartões das respostas rápidas cobrem os principais).
- Observações para o agente (`ai_notes`): nenhuma preenchida. São úteis para dizer indicação de uso, peso suportado e diferença entre modelos.
- Nomes vindos do Net Use estão abreviados ou cortados (ex.: "CONECTOR T 22F X 15F X 15F (MEDIDAS INTE"): vale revisar os mais vendidos.

