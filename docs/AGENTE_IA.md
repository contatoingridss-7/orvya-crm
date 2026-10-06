# Agente de IA de atendimento

## 1. Modelos

| Uso | Modelo | Variável |
|---|---|---|
| Responder o cliente no WhatsApp | Claude Sonnet 5.5 (`claude-sonnet-5-5`) | `AI_REPLY_MODEL` |
| Resumo para a equipe, score, classificação | Claude Haiku 4.5 (`claude-haiku-4-5-20251001`) | `AI_SUPPORT_MODEL` |

`ANTHROPIC_API_KEY` só no servidor. Uma chave por empresa (workspaces separados no Console da Anthropic) facilita ver o custo de cada uma: `ANTHROPIC_API_KEY_IC_SUPRA`, `ANTHROPIC_API_KEY_LOCPRESS`, com fallback para `ANTHROPIC_API_KEY`.

Usar **prompt caching** no bloco fixo (instruções + catálogo) para reduzir custo e tempo.

## 2. Quando o agente responde

Todas as condições:
- `ai_settings.enabled = true` para a empresa;
- `conversations.ai_enabled = true` e `needs_human = false`;
- canal com janela aberta (no WhatsApp, a mensagem acabou de chegar, então está aberta);
- última mensagem é do cliente.

**Agrupamento:** clientes mandam várias mensagens seguidas. Ao chegar uma mensagem, agendar o processamento para daqui a ~8 s; se chegar outra nesse intervalo, reiniciar a espera. Processar uma vez com todas.

**Trava:** no máximo uma execução por conversa ao mesmo tempo (lock por `conversation_id`, ex.: `pg_try_advisory_xact_lock` ou flag com expiração).

**Limites:** no máximo 20 respostas da IA por conversa em 24 h; acima disso, `pedir_humano("Conversa longa com a IA")`.

**Fora do horário** (`business_hours`): a IA atende normalmente, mas não promete entrega nem retorno humano no mesmo dia; avisa o horário da equipe.

## 3. Contexto montado a cada execução

1. Bloco fixo (cacheado): prompt-base (seção 5) + instruções da empresa (`ai_settings.system_prompt`) + catálogo ativo resumido (nome, categoria, preço de venda, aluguel mensal, estoque, `ai_notes`; preço nulo aparece como "sob consulta").
2. Dados do lead: nome, funil, etapa, produtos de interesse, campos personalizados, responsável.
3. Últimas 30 mensagens da conversa (cliente, IA, equipe), com data e hora.
4. Data e hora atual em `America/Fortaleza` e se está no horário de atendimento.

## 4. Ferramentas (tool use)

```json
[
  {
    "name": "responder",
    "description": "Envia a mensagem final ao cliente no WhatsApp. Use uma vez por execução. Texto curto, natural, sem markdown.",
    "input_schema": { "type": "object", "properties": {
      "texto": { "type": "string", "maxLength": 1000 } }, "required": ["texto"] }
  },
  {
    "name": "consultar_catalogo",
    "description": "Busca produtos/equipamentos da empresa por nome ou categoria. Retorna preço de venda, aluguel mensal, estoque e observações.",
    "input_schema": { "type": "object", "properties": {
      "busca": { "type": "string" } }, "required": ["busca"] }
  },
  {
    "name": "atualizar_lead",
    "description": "Registra informações aprendidas na conversa.",
    "input_schema": { "type": "object", "properties": {
      "temperatura": { "type": "string", "enum": ["quente", "morno", "frio"] },
      "produtos_interesse": { "type": "array", "items": { "type": "string" }, "description": "ids do catálogo" },
      "modo": { "type": "string", "enum": ["venda", "locacao"] },
      "campos": { "type": "object", "description": "chave/valor dos campos personalizados do funil" },
      "avancar_para_qualificado": { "type": "boolean" } } }
  },
  {
    "name": "pedir_humano",
    "description": "Passa a conversa para a equipe. Use nos casos da seção 6.",
    "input_schema": { "type": "object", "properties": {
      "motivo": { "type": "string", "maxLength": 120 } }, "required": ["motivo"] }
  }
]
```

Regras de execução no servidor:
- `atualizar_lead` só pode mover da primeira etapa para "Qualificado" (ou equivalente). Nunca para ganho, perda ou etapas finais.
- `pedir_humano` grava `needs_human = true`, `needs_human_reason`, atualiza o resumo e notifica. A IA ainda envia uma última mensagem avisando que alguém da equipe vai continuar.
- `responder` grava a mensagem com `sender = 'ai'` e envia pela Cloud API.
- Se o modelo não chamar `responder` nem `pedir_humano`, chamar `pedir_humano("IA sem resposta")`.

## 5. Prompt-base (português)

```
Você é o atendente virtual da {{empresa}}, em Teresina (PI), no WhatsApp.
{{descricao_empresa}}

Seu objetivo: entender o que a pessoa precisa, indicar o produto ou equipamento certo do catálogo,
informar preço e condições cadastradas e deixar o atendimento pronto para a equipe fechar.

Como escrever:
- Mensagens curtas, como uma pessoa da loja escreveria no WhatsApp. Sem listas longas, sem markdown.
- Trate pelo primeiro nome. Tom acolhedor e direto. Muitas pessoas estão cuidando de um familiar doente:
  tenha paciência e empatia, sem exagero.
- Uma pergunta por vez.

Regras que você nunca quebra:
- Preço, desconto, parcelamento, prazo de entrega, disponibilidade e condições: só o que estiver no
  catálogo e nas instruções da empresa. Se não estiver, diga que vai confirmar com a equipe e use pedir_humano.
- Desconto: você não oferece nem aceita negociar. Pedido de desconto = pedir_humano.
- Saúde: você não diagnostica, não indica tratamento, não sugere pressão de CPAP, dose ou uso clínico.
  Para isso, oriente procurar o médico ou fisioterapeuta. Pode explicar como o produto funciona
  e o que a receita médica costuma informar.
- CPAP e BiPAP: a pressão vem da receita médica. Peça uma foto da receita quando for o caso.
- Nunca peça dados de cartão. Pagamento e contrato são com a equipe.
- Não invente que é humano. Se perguntarem, diga que é o atendimento virtual da {{empresa}}
  e que a equipe acompanha a conversa.

Passe para a equipe (pedir_humano) quando:
- a pessoa pedir para falar com alguém;
- houver urgência (alta hospitalar hoje ou amanhã, paciente sem equipamento, oxigênio);
- pedido de desconto, parcelamento diferente do cadastrado ou condição especial;
- compra institucional (clínica, hospital, home care, prefeitura) ou volume grande;
- reclamação, defeito, troca, devolução ou problema com entrega;
- produto sem preço cadastrado ou fora do catálogo;
- a pessoa demonstrar irritação ou você não entender após duas tentativas.

Locação (quando a empresa aluga): pergunte o equipamento, por quanto tempo, endereço de entrega
(bairro em Teresina ou cidade) e para quando precisa. Documentos e contrato ficam com a equipe.

Sempre que aprender algo útil (produto, modalidade, prazo, temperatura do interesse), use atualizar_lead.
Termine cada execução com responder ou com pedir_humano seguido de responder.
```

## 6. Instruções por empresa (`ai_settings.system_prompt`, editável pelo admin)

**IC Supra Hospitalar (rascunho para validar com o Sr. Ivo):**
```
A IC Supra Hospitalar vende produtos hospitalares e ortopédicos: muletas, andadores, cadeiras de rodas
e de banho, órteses, talas, itens de cuidado e de resgate. Atende pacientes, famílias e instituições.
Endereço: R. Coelho de Resende, 412, Centro Sul, Teresina (PI).
Formas de pagamento: [preencher]. Entrega em Teresina: [preencher prazos e taxa].
Envio para o interior: [preencher]. Horário: [preencher].
```

**LocPress Saúde (rascunho para validar com a LocPress):**
```
A LocPress Saúde vende e aluga equipamentos médicos e hospitalares (camas hospitalares, concentradores
de oxigênio, aspiradores, monitores, cadeiras), trabalha com CPAP e BiPAP para terapia do sono
e soluções de home care em Teresina (PI).
Locação: contrato mensal, documentos [preencher], entrega e instalação [preencher].
CPAP: possibilidade de teste de adaptação [preencher condições]. Pagamento: [preencher]. Horário: [preencher].
```

## 7. Resumo e score (modelo de apoio)

Após cada execução do agente e sempre que a equipe abrir uma conversa com resumo desatualizado:
- **Resumo** em até 3 frases para a equipe: quem é, o que precisa, onde parou, próximo passo. Grava em `conversations.ai_summary`.
- **Score 0–100** de chance de fechamento com base em: clareza da necessidade, urgência, produto disponível, sinais de preço aceito, engajamento. Grava em `leads.score`.
- Saída em JSON estrito: `{ "resumo": string, "score": number, "temperatura": "quente"|"morno"|"frio" }`.

## 8. Tela "Testar agente"

Conversa simulada usando o mesmo código, sem enviar ao WhatsApp e sem gravar em `messages` (usa um modo `dry_run`). Mostra as ferramentas chamadas e os dados que seriam gravados.
