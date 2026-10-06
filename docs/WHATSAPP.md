# WhatsApp — API oficial (Cloud API)

## 1. Preparação na Meta (fora do código)

Uma vez, pelo administrador da plataforma:
1. **Aplicativo Meta** (tipo Business) em developers.facebook.com, com o produto **WhatsApp** adicionado. Esse app é da Orvya e atende as duas empresas.
2. Anotar o **App Secret** (`META_APP_SECRET`) e definir um **token de verificação** do webhook (`META_WEBHOOK_VERIFY_TOKEN`, texto aleatório).
3. Em WhatsApp > Configuração, apontar o webhook para `https://SEU_DOMINIO/api/webhooks/whatsapp` e assinar o campo **messages**.

Para cada empresa:
1. **Gerenciador de Negócios** da empresa verificado (CNPJ). Pode levar alguns dias: começar já.
2. **Conta do WhatsApp Business (WABA)** da empresa, compartilhada com o app da Orvya.
3. **Usuário do sistema** com token permanente com permissões `whatsapp_business_messaging` e `whatsapp_business_management`. Esse token vai para `whatsapp_credentials` (nunca para o código).
4. Para cada número (até 2): adicionar, verificar por SMS/ligação, definir nome de exibição, registrar na Cloud API (`POST /{phone_number_id}/register` com PIN de 6 dígitos) e inscrever o app na WABA (`POST /{waba_id}/subscribed_apps`).
5. Se o número já usa o app **WhatsApp Business** no celular, avaliar a conexão com **coexistência** (o número segue no app e na API). Confirmar no momento da conexão quanto do histórico recente a Meta sincroniza.
6. Forma de pagamento na WABA (cobrança dos modelos de mensagem).

**Para desenvolver hoje sem esperar a verificação:** o painel do app oferece um **número de teste** da Meta e permite cadastrar alguns números de destino para testes. Use-o para construir e validar todo o fluxo. Troque pelo número real quando a empresa estiver verificada.

No banco, cada número conectado preenche em `whatsapp_numbers`: `phone_number_id`, `waba_id`, `display_phone`, `status = 'connected'`, `connected_at`; e o token em `whatsapp_credentials`.

## 2. Variáveis de ambiente

```
META_APP_SECRET=
META_WEBHOOK_VERIFY_TOKEN=
META_GRAPH_VERSION=        # use a versão atual indicada na documentação da Meta, ex.: v2x.0
```

Base: `https://graph.facebook.com/${META_GRAPH_VERSION}`.

## 3. Webhook (`app/api/webhooks/whatsapp/route.ts`)

### GET — verificação
Se `hub.mode === 'subscribe'` e `hub.verify_token === META_WEBHOOK_VERIFY_TOKEN`, responder `hub.challenge` em texto puro com status 200. Senão, 403.

### POST — eventos
1. Ler o corpo **cru** (`await req.text()`), calcular `sha256=` + HMAC-SHA256(corpo, `META_APP_SECRET`) e comparar com o cabeçalho `X-Hub-Signature-256` usando comparação de tempo constante. Falhou → 401.
2. Gravar o payload em `webhook_events` (service_role).
3. Responder **200 imediatamente** e processar em segundo plano (`after()` do Next.js 15). A Meta reenvia se não receber 200 rápido.
4. Para cada `entry[].changes[].value`:
   - `metadata.phone_number_id` → localizar `whatsapp_numbers` (e a empresa). Desconhecido → registrar erro e ignorar.
   - `contacts[0].profile.name` e `contacts[0].wa_id` → nome e telefone do contato.
   - `messages[]` → mensagens recebidas (ver 3.1).
   - `statuses[]` → status das mensagens enviadas (ver 3.3).
5. Marcar `webhook_events.processed_at` (ou `error`).

### 3.1 Mensagens recebidas
Campos principais de cada item de `messages[]`: `from` (wa_id), `id` (wamid, **usar como `wa_message_id`**), `timestamp`, `type` e o objeto do tipo (`text.body`, `image{id, mime_type, caption}`, `audio{id}`, `document{id, filename, caption}`, `video`, `location`, `interactive`, `button`, `reaction`).

- **Idempotência:** `insert ... on conflict (wa_message_id) do nothing`. Se já existia, parar.
- **Telefone:** responda sempre para o `wa_id` exatamente como veio. Para casar com contatos já cadastrados, normalize para E.164 e, em números brasileiros, considere a variação com e sem o nono dígito.
- **Anúncio de clique para o WhatsApp:** a primeira mensagem pode trazer `referral` (`source_url`, `source_id`, `source_type`, `headline`, `ctwa_clid`). Gravar em `leads.ad_referral` e origem "Meta Ads".
- **Resposta a mensagem anterior:** `context.id` aponta a mensagem citada.
- **Reação:** registrar como mensagem `msg_type = 'reaction'` sem abrir janela de atendimento nova na interface (mas ela conta como mensagem do cliente).
- Atualizar a conversa: `last_inbound_at = timestamp`, `last_message_at`, `unread_count + 1`.
- Depois de gravar, disparar o agente de IA se aplicável (ver `AGENTE_IA.md`).

### 3.2 Mídia recebida
1. `GET /{media_id}` com o token → retorna `url` e `mime_type`.
2. `GET {url}` com `Authorization: Bearer {token}` → arquivo.
3. Salvar no bucket `whatsapp-media` em `{company_id}/{conversation_id}/{message_id}.{ext}` e gravar `media_path` e `media_mime`.
4. A interface pede URL assinada a uma rota do servidor, que confere se o usuário vê a conversa (consulta com o cliente autenticado) antes de gerar a URL (validade curta, ex.: 10 min).

O link da Meta expira: baixe na hora, não guarde a URL dela.

### 3.3 Status das mensagens enviadas
Cada item de `statuses[]`: `id` (wamid), `status` (`sent`, `delivered`, `read`, `failed`), `timestamp`, `errors[]`, `pricing` (categoria cobrada) e `conversation`. Atualizar `messages` por `wa_message_id`; nunca regredir status (`read` não volta para `delivered`). Em `failed`, gravar `error` e mostrar na bolha.

## 4. Envio (`app/api/whatsapp/send/route.ts`, só servidor)

Entrada: `conversation_id` + (`text`) ou (`template_id` + variáveis) ou (`media`).

1. Carregar a conversa **com o cliente autenticado do usuário** → se não vier, o RLS bloqueou: 403.
2. Checar o número: `status = 'connected'`.
3. **Janela:** aberta se `last_inbound_at > now() - 24h`. Texto livre ou mídia só com janela aberta. Fora dela, só modelo com `status = 'approved'`.
4. Ler o token em `whatsapp_credentials` (service_role) e chamar a Meta.
5. Gravar a mensagem (service_role) com `direction = 'out'`, `sender = 'user'`, `user_id`, `wa_message_id` retornado, `status = 'sent'`.
6. Atualizar a conversa: `ai_enabled = false`, `needs_human = false`, `assigned_to = coalesce(assigned_to, user_id)`, `last_message_at`. Se o lead não tinha responsável e quem enviou é vendedor, ele vira o responsável.

### Formatos

Texto:
```json
POST /{phone_number_id}/messages
{ "messaging_product": "whatsapp", "recipient_type": "individual", "to": "<wa_id>",
  "type": "text", "text": { "body": "Olá!", "preview_url": false } }
```

Modelo:
```json
{ "messaging_product": "whatsapp", "to": "<wa_id>", "type": "template",
  "template": { "name": "retomar_orcamento", "language": { "code": "pt_BR" },
    "components": [ { "type": "body", "parameters": [
      { "type": "text", "text": "Maria" }, { "type": "text", "text": "muleta axilar" } ] } ] } }
```

Marcar como lida (ao abrir a conversa na interface):
```json
{ "messaging_product": "whatsapp", "status": "read", "message_id": "<wamid>" }
```

Mídia: enviar o arquivo para `POST /{phone_number_id}/media` (multipart) e depois mandar `type: image|document|audio` com o `id` retornado.

## 5. Modelos de mensagem

- Criar: `POST /{waba_id}/message_templates` com `name`, `language: "pt_BR"`, `category` (`MARKETING` ou `UTILITY`) e `components` (corpo com `{{1}}`, `{{2}}` e exemplos).
- Sincronizar status: `GET /{waba_id}/message_templates` (job a cada 15 min e botão "Atualizar") → grava `status` e `rejected_reason`.
- Na interface, o corpo aparece com os nomes amigáveis (`{{nome}}`, `{{produto}}`), mapeados para a ordem de `variables`.
- Categoria: aviso de pedido, entrega, contrato = **Utilidade**. Qualquer oferta ou convite para comprar = **Marketing** (mais caro). A Meta pode reclassificar.
- Modelos iniciais sugeridos estão no protótipo (tela Canais e integrações).

## 6. Custos (para mostrar estimativas)

A cobrança é por modelo enviado, conforme a categoria e a tabela vigente da Meta para o Brasil. Respostas dentro da janela de 24 h aberta pelo cliente não têm custo de mensagem. Guardar os valores por categoria em configuração (não no código) e somar pelo `pricing` dos status para o painel.

## 7. Testes mínimos antes de ligar um número real

- Verificação do webhook (GET) e assinatura inválida (401).
- Mensagem de texto, imagem, áudio e documento chegando e aparecendo ao vivo.
- Mesmo evento entregue duas vezes não duplica.
- Envio de texto com janela aberta; bloqueio com janela fechada; envio de modelo.
- Status enviado → entregue → lido refletindo na bolha.
- Vendedor não consegue enviar em conversa de outro vendedor (403).
