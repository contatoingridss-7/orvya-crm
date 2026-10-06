# Integrações de anúncios e site (fase 2)

Objetivo: o painel "Origem dos leads" mostrar o retorno de cada campanha em **vendas fechadas**, e as plataformas de anúncio aprenderem com quem compra.

Status de cada integração fica em `integrations` (`kind`, `status`, `config` sem segredos). Segredos em variáveis de ambiente.

## 1. Site (fazer primeiro: é o mais simples)

**Script de captura** (servido em `/orvya.js`, colado no site):
- Na chegada, ler `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, `gclid`, `fbclid` da URL e guardar em cookie primário por 90 dias (primeiro toque e último toque).
- Expor `window.Orvya.attach(form)`, que adiciona esses dados como campos ocultos.

**Recebimento** `POST /api/public/lead`:
- Corpo: `{ empresa: "ic-supra" | "locpress", nome, telefone, email?, mensagem?, produto?, utm: {...} }`.
- Proteção: chave pública por empresa (`integrations.config.public_key`), checagem de origem (domínio do site), limite de requisições por IP e campo isca contra robôs.
- Cria ou atualiza o contato, cria o lead na primeira etapa do funil padrão com origem "Site" (ou "Google Ads"/"Meta Ads" se houver `gclid`/`fbclid`), grava `utm`.

**Botão de WhatsApp rastreado:** link `https://wa.me/55DDDNUMERO?text=` com mensagem pré-preenchida terminando em um código curto (ex.: `[S-4F2]`) gerado pelo script e associado aos UTMs no servidor. Quando a mensagem chega, o webhook reconhece o código, liga ao UTM e remove o código da exibição.

## 2. Meta Ads

**Anúncios de clique para o WhatsApp:** nada a configurar além do número conectado. O `referral` da primeira mensagem já identifica o anúncio (ver `WHATSAPP.md`).

**Formulários de lead (Lead Ads):**
- Página do Facebook ligada ao Gerenciador de Negócios; app com permissão de leitura de leads aprovada.
- Assinar o webhook do objeto **page**, campo **leadgen**, apontando para `/api/webhooks/meta-leads`.
- Ao receber `leadgen_id`, buscar os dados com `GET /{leadgen_id}` e criar contato + lead (origem "Meta Ads", `utm` com `campaign_id`, `adset_id`, `ad_id`, `form_id`).
- Mapeamento formulário → funil configurável na tela.

**API de Conversões (CAPI):**
- Conjunto de dados (pixel) e token de acesso em variável de ambiente.
- Enviar eventos do servidor quando: lead qualificado (`Lead`), venda fechada (`Purchase` com `value` e `currency: BRL`), locação iniciada (evento personalizado com valor do contrato).
- Dados do cliente com hash SHA-256 (telefone E.164 e e-mail normalizados), `event_id` único para evitar duplicidade, `action_source` adequado ao canal.
- Disparo por gatilho de mudança de etapa (fila no servidor, com nova tentativa em caso de falha).

## 3. Google Ads

**Formulários de lead do Google:**
- `POST /api/webhooks/google-leads` com chave própria por empresa (`integrations.config.webhook_key`) informada no formulário da campanha.
- O corpo traz os campos do formulário, `gcl_id` e ids de campanha. Criar contato + lead com origem "Google Ads".

**Conversões de vendas (offline):**
- Criar no Google Ads a ação de conversão "Venda no CRM".
- **Começo:** exportação diária automática (planilha ou CSV) com `gclid`, nome da conversão, data/hora e valor das vendas fechadas, importada pelo agendamento do próprio Google Ads.
- **Depois:** envio direto pela API do Google Ads (exige token de desenvolvedor aprovado e conta de administrador).

## 4. Instagram Direct e Messenger

Mesmo app Meta. Conta profissional do Instagram ligada à página. Assinar os webhooks de mensagens de cada canal e reutilizar o fluxo de conversas (`channel = 'instagram' | 'messenger'`). Esses canais também têm regras de janela de resposta; validar na documentação da Meta antes de liberar envio fora da janela.

## 5. Ordem sugerida

1. Site (script + formulário + botão rastreado).
2. Meta: CAPI (maior impacto na qualidade dos anúncios) e Lead Ads, se a empresa usar formulários.
3. Google: formulários e conversões por planilha.
4. Instagram e Messenger.
