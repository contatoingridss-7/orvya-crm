# Orvya — instruções do projeto

**Orvya** é um CRM comercial com atendimento por WhatsApp (API oficial da Meta), agente de IA e funil de vendas.
Assinatura da marca: **VÉR7ICE Orvya**. Slogan: **"Conexões inteligentes. Resultados integrados."**

Clientes iniciais (multiempresa desde o primeiro dia):

| Empresa | Ramo | Funis |
|---|---|---|
| IC Supra Hospitalar (Teresina, PI) | Venda de produtos hospitalares e ortopédicos | Varejo, Institucional |
| LocPress Saúde (Teresina, PI) | Venda e locação de equipamentos médicos e hospitalares, CPAP e home care | Venda, Locação, CPAP e home care |

Cada empresa tem até **2 números de WhatsApp**, todos pela **API oficial (WhatsApp Cloud API)**. Começamos testando com 1 número por empresa.

## Documentos de referência (leia antes de codar)

- `docs/SPEC.md` — perfis, permissões, telas e fluxos. **Fonte da verdade funcional.**
- `docs/WHATSAPP.md` — webhook, envio, janela de 24 h, modelos, mídia.
- `docs/AGENTE_IA.md` — agente de atendimento, ferramentas, prompt e regras de passagem para humano.
- `docs/INTEGRACOES.md` — Meta Ads, Google Ads e site (fase 2).
- `docs/prototipo/orvya-prototipo.html` — **protótipo navegável aprovado pelo cliente. Fonte da verdade visual.** Abra no navegador e reproduza layout, textos e comportamento.
- `supabase/migrations/0001_init.sql` — esquema completo com RLS. Não altere regras de acesso sem atualizar a SPEC.
- `supabase/seed.sql` — empresas, funis, etapas, campos, origens, motivos de perda, automações e catálogo inicial.

## Stack

- **Next.js 15 (App Router) + TypeScript estrito + Tailwind CSS.** Componentes próprios seguindo o protótipo (pode usar Radix/shadcn como base de acessibilidade, mas o visual é o do protótipo).
- **Supabase**: Postgres, Auth (e-mail e senha), Storage (mídia do WhatsApp), Realtime (mensagens e cards ao vivo).
- **@supabase/ssr** para sessão no servidor. Cliente com `anon key` no navegador; `service_role` **somente** em código de servidor (route handlers, server actions, jobs).
- **Anthropic SDK (`@anthropic-ai/sdk`)** para o agente. Modelos em variáveis de ambiente.
- **Deploy**: Vercel (frontend + route handlers). Projeto Supabase na região **São Paulo (sa-east-1)**.
- Validação com **zod**. Datas com `date-fns` + `date-fns-tz`. Fuso padrão: `America/Fortaleza` (Teresina).

## Estrutura sugerida

```
app/
  (auth)/login, (auth)/recuperar-senha, (auth)/redefinir-senha
  (app)/[empresa]/painel | funil | conversas | fila | tarefas | catalogo
  (app)/[empresa]/config/automacoes | canais | modelos | equipe | ia
  api/webhooks/whatsapp/route.ts      ← GET verificação, POST eventos
  api/whatsapp/send/route.ts          ← envio de texto/modelo (server only)
  api/public/lead/route.ts            ← formulário do site (fase 2)
lib/
  supabase/{client,server,admin}.ts
  whatsapp/{client,webhook,templates,media}.ts
  ai/{agent,tools,prompts,summary}.ts
  auth/roles.ts
components/ (kanban, inbox, lead-drawer, ...)
supabase/ (migrations, seed.sql)
```

`[empresa]` é o `slug` da empresa (`ic-supra`, `locpress`). Vendedor e gestor com uma empresa só são redirecionados direto para ela.

## Regras de implementação (obrigatórias)

1. **Toda a interface em português do Brasil.** Moeda `R$` com `Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })`. Datas no formato brasileiro.
2. **Segurança vem do banco (RLS).** Nunca confie só em esconder botão. Toda consulta de usuário usa o cliente autenticado; o `service_role` só é usado em webhooks, envio para a Meta e jobs.
3. **Webhook da Meta:** validar assinatura `X-Hub-Signature-256` com `META_APP_SECRET`, responder 200 rápido, gravar o payload bruto em `webhook_events`, processar de forma **idempotente** por `wa_message_id`.
4. **Janela de 24 h:** fora dela, só é permitido enviar **modelo aprovado**. Validar no servidor, não só na tela.
5. **Mídia recebida:** baixar da Meta assim que chegar (o link expira) e salvar no bucket privado `whatsapp-media` em `{company_id}/{conversation_id}/{message_id}.{ext}`. A tela recebe **URL assinada** gerada no servidor após checar acesso à conversa.
6. **Dados de saúde (LGPD):** receita, diagnóstico e condição do paciente são dados sensíveis. Não registrar em logs de aplicação, não enviar para serviços externos além da Meta e da Anthropic, e manter o acesso restrito pelo RLS.
7. **IA nunca inventa condição comercial.** Preço, desconto, prazo e disponibilidade saem do catálogo. Produto sem preço cadastrado = passar para humano.
8. **Mensagem enviada por pessoa da equipe pausa a IA naquela conversa** (`conversations.ai_enabled = false`).
9. **Mover lead para etapa de perda exige motivo** (o banco já bloqueia sem `lost_reason`).
10. Segredos só em variáveis de ambiente ou na tabela `whatsapp_credentials` (sem acesso de usuário). Nunca no código nem no navegador.

## Design (extraído do protótipo)

- Fonte: `-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", Inter, system-ui, sans-serif` (Inter do Google Fonts como reserva).
- Acento: `#7C5CFF`; gradiente `linear-gradient(135deg, #6D4AFF 0%, #9B7BFF 100%)`.
- Ganho `#10B981`, perda `#EF4444`, alerta `#F59E0B`.
- **Escuro:** fundo `#07070A`, lateral `#0C0C11`, superfície `#111117`, superfície 2 `#16161E`, elevada `#1C1C26`, borda `#22222C`, texto `#EDEDF2`, secundário `#8B8B9A`. Brilho violeta radial na parte de baixo da tela.
- **Claro:** fundo `#F4F4F7`, superfície `#FFFFFF`, superfície 2 `#F8F8FB`, borda `#E7E7EE`, texto `#16161D`, secundário `#6E6E7C`, tom `#F1EEFF`.
- Raio 16 px nos painéis, 12 px em botões e cards. Botão primário com gradiente.
- Alternância claro/escuro no topo de todas as telas; padrão = tema do aparelho; preferência salva por usuário.
- Marca no topo da lateral: símbolo (círculo com ponto em órbita) + "Orvya" + slogan. Rodapé da lateral: "VÉR7ICE Orvya". Tela de login com marca, slogan e assinatura.
- Mobile primeiro para o perfil **vendedor** (ele trabalha no celular).

## Comandos

```
npm run dev            # desenvolvimento
npm run build && npm start
npx supabase db push   # aplica migrations no projeto remoto
npx supabase db reset  # local: recria banco + seed
npm run typecheck && npm run lint
```

## Definição de pronto (por funcionalidade)

- Funciona para os 3 perfis conforme a matriz da SPEC (testar logado como cada um).
- Funciona no celular (390 px) e no desktop, nos modos claro e escuro.
- Sem erro de TypeScript ou lint. Sem segredo no bundle do cliente.
- Estados vazios, de carregamento e de erro tratados com texto em português.
