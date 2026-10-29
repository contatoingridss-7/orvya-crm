# Orvya — andamento (atualizado em 16/10/2026)

Leia junto com `CLAUDE.md`, `KICKOFF.md` e `docs/SPEC.md`. Este arquivo registra o que já foi feito,
decisões tomadas e o que falta, para retomar o trabalho numa conversa nova.

## No ar
- Site: https://orvya-crm.vercel.app (Vercel, plano Hobby — passar para Pro antes do uso pelos clientes)
- Banco: Supabase `psewjkrpwnmrmiwwmcgw` (São Paulo, plano gratuito — passar para Pro antes do uso real; pausa após 7 dias sem uso)
- Repositório: github.com/contatoingridss-7/orvya-crm (commits com "Ingrid Soares <contatoingridss@gmail.com>")
- Migrations aplicadas no Supabase: 0001 a 0007 (0008, 0009 e 0010 pendentes de confirmação). Dados de exemplo ativos (`supabase/exemplos/*`; remover antes do uso real com `remover_exemplos.sql`).

## Pronto e testado
| Fase | Conteúdo |
|---|---|
| 0 | Base Next.js 15 + Tailwind, tokens do protótipo claro/escuro, clientes Supabase |
| 1 | Login, recuperar/redefinir senha, perfis, seletor de empresa, tela Equipe (convite ou senha provisória) |
| 2a | Catálogo + importação no navegador dos PDFs do Net Use (estoque, vendas IC, vendas/serviços LocPress) e CSV/XLSX; preço de referência separado do confirmado; locação = "negociado pela equipe" |
| 2b | Funil kanban (dnd-kit), detalhe do lead, novo lead, motivo de perda, produtos de interesse, histórico |
| 2c | Tarefas, automações por etapa, RLS de contatos (0004) |
| 2d | Painel (KPIs, funil, origem, atenção) e Meu dia (vendedor) |
| 2e | Contratos de locação LocPress (vencimentos, renovar/encerrar, receita de locação, rented_count automático — 0005) |
| 3a | Webhook `/api/webhooks/whatsapp` (assinatura, webhook_events, idempotência, mídia no bucket), tela Canais, origem por `referral` (Meta Ads) e código `[G1]`/`[S1]` (Google Ads/Site) |
| 3b-1 | Tela Conversas ao vivo (Realtime), resposta com janela de 24 h, assumir, marcar lida, mídia por URL assinada (`/api/media/[id]`), retry do nono dígito (BR) |
| — | Política de privacidade pública `/privacidade` (#exclusao), rodapé com "VÉR7ICE Orvya é uma marca de Ingrid Santos Soares · CNPJ 64.998.911/0001-32", ícone em `docs/marca` |

## Meta / WhatsApp
- App **Orvya LocPress** no Gerenciador de Negócios da LocPress, publicado (Ao vivo). Caso de uso WhatsApp, webhook verificado, campo `messages` assinado (versão no painel v26.0; `META_GRAPH_VERSION=v25.0` na Vercel).
- Número de **teste** da Meta conectado na vaga 1 da LocPress (funil Locação), token **permanente** (usuário do sistema). Testado ponta a ponta: receber, mídia, responder.
- Variáveis na Vercel: Supabase (3), `NEXT_PUBLIC_APP_URL`, `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN`, `META_GRAPH_VERSION`.
- **Um app por empresa** (não somos Tech Provider). App **Orvya IC Supra** criado no portfólio "Hospitalar iC" (21/10). `META_APP_SECRET` aceita os segredos dos dois apps separados por vírgula. Domínio `icsuprahospitalar.com.br` verificado na Meta (DNS na Hostinger).
- Verificação de empresa: **LocPress concluída**; **IC Supra** em andamento (telefone do CNPJ é da contabilidade: preencher dados à mão e confirmar pelo domínio verificado).

## Decisões
- Números atuais (2 IC + 2 LocPress) continuam no app WhatsApp Business do celular. Coexistência exige Tech Provider ou parceiro (360dialog etc.) — adiado.
- Caminho escolhido: **2 chips novos (eSIM de operadora, DDD 86), 1 por empresa**, só para o Orvya. Testar primeiro na LocPress.
- **Agente de IA desligado** por custo; pode voltar como triagem (Haiku) no futuro.
- Preços confirmados do catálogo: depois (tabela do Sr. Ivo / LocPress).
- Custos do WhatsApp para os decisores: artifact "Custos do WhatsApp no Orvya".

## Construído, aguardando teste da usuária (14/10)
- **3b-2** — modelos de mensagem: painel em Canais (criar/enviar para aprovação, atualizar status, excluir), envio de modelo na conversa (janela fechada), webhook `message_template_status_update`. Arquivos: `config/canais/template-actions.ts`, `templates-panel.tsx`, `lib/whatsapp/{templates,pricing,accounts}.ts`.
- **3c** — "Precisa de mim" (`fila/`): conversas com pedido de atendimento e "sem resposta da equipe" (>30 min), reativação em lote com modelo, prévia e custo; fila `outbound_queue` (migration 0008) processada por `/api/jobs/fila-envio` (Bearer `CRON_SECRET`), disparada pelo pg_cron do Supabase (`supabase/exemplos/agendar_fila_envio.sql`, segredo colado só no SQL Editor) e cron diário de segurança em `vercel.json`. Lógica de envio centralizada em `lib/whatsapp/send.ts`; contador vermelho no menu.
- Pendências de configuração: assinar `message_template_status_update` no webhook da Meta; `CRON_SECRET` na Vercel + redeploy; rodar 0008; rodar o SQL do pg_cron.

## Construído, aguardando teste da usuária (16/10) — ajustes pedidos pela gestão
Migration **0009_logistica_cpap.sql** (testada localmente em PGlite: roda duas vezes seguidas e as permissões batem).
- **Perfil Expedição** (`logistica`): tela `expedicao/` com pedidos agendados (Atrasados, Hoje, Amanhã, Próximos, Entregues), avanço Agendado → Separado → Faturado → Saiu para entrega → Entregue, ligar/abrir no mapa. Sem acesso a leads, contatos, conversas, tarefas nem dados de saúde (funções `logistics_orders` e `logistics_set_status`).
- **Agendamento integrado**: etapas "Entrega agendada" (Varejo, Institucional, Venda, Locação, CPAP) e "Adaptação programada" (teste in loco do CPAP). Mover para elas pede data, hora, endereço e observação. Entregue → lead vai para o ganho.
- **Follow-up do CPAP** 24 h, 7 e 15 dias após a entrega (automações "ao entregar", editáveis em Automações). Cards com "Tarefa atrasada" e "Tarefa para hoje".
- **Funil CPAP na IC Supra** + vendedor restrito a funis (`memberships.pipeline_ids`), definido em Equipe → Funis (Thays).
- **Fotos no catálogo** (bucket público `product-photos`): gestor, admin e expedição, pelo celular.
- **Relatórios** (`relatorios/`): tarefas por pessoa, atrasadas, entregas, Baixar PDF. **E-mail aos sábados 8h** (`/api/jobs/relatorio-semanal`, cron da Vercel) — só números (LGPD).
- **Precisa de mim**: alerta com 5 min sem resposta (antes 30), cronômetro ao vivo e atualização a cada 30 s.
- Pendências de configuração: rodar **0009** ANTES de publicar o código (as telas leem colunas novas); criar conta no Resend + `RESEND_API_KEY` e `EMAIL_FROM` na Vercel (sem domínio próprio, o Resend só entrega para o e-mail dono da conta); cadastrar a Thays (vendedor na IC, funil CPAP) e o login da expedição.

## Construído, aguardando teste (17/10) — automações de controle da demanda
Migration **0010_automacoes.sql** (testada em PGlite, idempotente).
- **Tarefas prontas** em "O que precisa ser feito" (Tarefas e detalhe do lead), cadastradas em Automações → Tarefas prontas, já com uma lista por funil.
- **Parado na etapa**: regras com `after_days`; `run_stale_automations()` pelo pg_cron (hora em hora, agendado pela própria migration se o pg_cron estiver ligado) e `/api/jobs/automacoes` (cron diário da Vercel).
- **Tarefa atrasada há mais de 1 dia** aparece em Precisa de mim e soma no contador.
- **Reposição de consumíveis do CPAP**: filtro (30 dias) e máscara (90 dias) após a entrega, repetindo ao concluir (`repeat_days`).
- Ao rodar a 0010, leads antigos já parados recebem as tarefas na primeira rodada.

## Construído, aguardando teste (25/10) — Tráfego (só administradora)
Migration **0011_trafego.sql** (testada em PGlite). Tela `trafego/`, `lib/ads/{meta,sync,report}.ts`, `/api/jobs/trafego` (crons 9h e 16h UTC). Falta: rodar 0011; no app de cada empresa adicionar o caso de uso de Marketing API (ads_read), atribuir a conta de anúncios ao usuário do sistema "Orvya" (gerenciar, para ler o saldo) e gerar token com ads_read; conectar em Tráfego. Número oficial da LocPress (86) 9432-0549 conectado na vaga 2 em 25/10.

## Construído, aguardando teste (25/10) — Histórico de vendas
Migration **0012_historico_vendas.sql** (testada em PGlite). Tela `vendas/`, gravação na importação do catálogo, coluna "Vende/mês" no Catálogo. Vendedor só quantidades (regra no banco).

Migration **0014_carregamentos.sql** (testada em PGlite): registro de cada carregamento do catálogo (`catalog_imports`), mostrado no Catálogo e em Importar até o próximo. Tráfego: conta aparece como "Conectada", formulário de token recolhido e, se a rotina não rodou há mais de 6 h, a própria visita atualiza com o token guardado (`after`). Diagnóstico de 25/10: nada é apagado em deploy (dados no banco); as rotinas não rodavam porque `CRON_SECRET` não estava cadastrado na Vercel.

Migration **0015_google_ads.sql** (testada em PGlite): Google Ads no Tráfego. Login da Google (`/api/google-ads/connect` → `/callback`), acesso de longa duração guardado em `ad_credentials` (só servidor), escolha da conta (inclusive via MCC, `login_customer_id`), sincronização diária junto com a Meta (`lib/ads/google.ts`, API v26, sem developer token). Projeto "Orvya" no Google Cloud com tela de consentimento em produção; acesso Exploração solicitado em 25/10. Variáveis na Vercel: `GOOGLE_ADS_CLIENT_ID`, `GOOGLE_ADS_CLIENT_SECRET` (opcional: `GOOGLE_ADS_API_VERSION`; a MCC é detectada sozinha).

## Instagram Direct (funcionando na LocPress desde 25/10)

Migration **0013_instagram.sql**. Direct em Conversas, menu de boas-vindas com botões que leva ao WhatsApp, palavra-chave, comentário que vira mensagem privada, lead com origem "Instagram Direct". Testado de ponta a ponta com a @locpress.saudeteresina.

Passo a passo que funcionou (repetir para a IC):
1. Instagram profissional ligado à Página do Facebook da empresa.
2. App da empresa → Casos de uso → **API do Instagram** → Permissões e recursos: `instagram_basic`, `instagram_manage_messages`, `instagram_manage_comments`, `pages_read_engagement`, `pages_show_list`, `business_management` e os recursos **Human Agent** e **Business Asset User Profile Access**. (`pages_manage_metadata` não aparece nesse caso de uso; o Orvya conecta sem ela.)
3. Webhook: só é aceito em **"Configuração da API com login do Instagram" → Configurar webhooks** (a página geral de Webhooks recusa). URL `https://orvya-crm.vercel.app/api/webhooks/whatsapp`, token = `META_WEBHOOK_VERIFY_TOKEN`, campos `messages` e `comments` na v26.0.
4. Esse webhook assina com a **chave secreta do app do Instagram** (topo da mesma página): na Vercel, `META_INSTAGRAM_APP_SECRET` (separada por vírgula se houver mais de uma). Recusas de assinatura ficam em `webhook_events` com `source = 'recusado'`.
5. Funções do app → Adicionar pessoas → **Testador do Instagram** para a conta da empresa e para quem vai testar; aceitar em instagram.com/accounts/manage_access (Convites de testador).
6. "Configuração da API com login do Instagram" → Gerar tokens de acesso → **Adicionar conta** (a da empresa) → ligar **Assinatura de webhook**. Sem isso, a Meta entrega só o evento de teste, não as mensagens reais.
7. Gerenciador de Negócios → Usuários do sistema → Orvya → atribuir a Página (controle total) → gerar token (validade Nunca) com as permissões do item 2.
8. Instagram da empresa → Configurações → Mensagens e respostas aos stories → Ferramentas conectadas → **Permitir acesso às mensagens**.
9. Orvya → Canais e integrações → Instagram Direct → colar o token → Buscar contas → conta e funil → Conectar. Menu e respostas em Automações.

Limite atual: sem Acesso Avançado, só Testadores do Instagram chegam ao Orvya; mensagens de clientes continuam no app do Instagram. Para liberar: Análise do App (`instagram_manage_messages`, `instagram_manage_comments`, Human Agent) com texto de uso e vídeo de tela.

## Coexistência e modelos (28/10)

**Modelos de mensagem**: 4 por empresa enviados à Meta em 28/10 (retomada_orcamento, encerramento_atendimento, pos_venda: marketing; confirmacao_entrega: utilidade), em análise. Sem forma de pagamento na conta do WhatsApp, modelo aprovado não é entregue. Desde 01/10/2026 a Meta cobra respostas acima de 1.000 por mês por número; conversa vinda de anúncio de clique para o WhatsApp é grátis por até 7 dias.

**Coexistência** (mesmo número no app WhatsApp Business e no Orvya, sem chip novo): migration **0016_coexistencia.sql**; botão "Conectar com a Meta" em Canais (Embedded Signup com `featureType: whatsapp_business_app_onboarding`), troca do código por token da empresa, inscrição na WABA, pedido de sincronização de contatos e histórico (`smb_app_data`, prazo de 24 h), webhooks `smb_message_echoes` (já tratados), `history` (já tratado), `smb_app_state_sync` (contatos) e `account_update` (desconexão pelo app). Falta o lado da Meta: VÉR7ICE verificada, app próprio da VÉR7ICE como Tech Provider (análise de `whatsapp_business_messaging` e `whatsapp_business_management`), configuração do Login do Facebook para Empresas (Embedded Signup) e, na Vercel, `META_ES_APP_ID`, `META_ES_CONFIG_ID`, `META_ES_APP_SECRET`.

## Construído, aguardando teste (29/10) — Indicadores e relatórios de tráfego

Migration **0018_trafego_indicadores.sql** (rodar no Supabase). A atualização da Meta passa a puxar também **por anúncio e por dia** (`ad_ad_daily`) e a **frequência real dos últimos 7 dias** (`ad_ad_window`, calculada pela Meta para o período inteiro). Na tela Tráfego:
- **O que olhar agora**: leitura automática por regras (`lib/ads/insights.ts`), sem IA: criativo saturado (frequência 7d ≥ limite e CTR caindo ≥ 25%), frequência alta, CTR em queda ou abaixo do mínimo, custo por conversa acima da meta (ou +30% sem meta), custo por lead, por venda e ROAS contra a meta, CPM subindo, leads do anúncio esperando resposta, primeira resposta lenta (mediana, seg a sáb 7h–19h), leads sem venda, conversas que não viraram lead, saldo, melhor criativo.
- Indicadores com variação contra o período anterior e contra a meta; **funil** impressões → cliques → conversas → leads → respondidos → vendas; **criativos** com miniatura, saúde (Saudável, Atenção, Saturado), frequência, tendência de CTR e custo por conversa.
- **Metas do cliente** (`traffic_goals`): custo por conversa, por lead, por venda, ROAS mínimo, frequência máxima (3) e CTR mínimo (0,8%).
- **Relatórios para o cliente** (`traffic_reports`): todo dia às 6h o rascunho de ontem; às segundas, também o da semana passada. A gestora escreve "o que fizemos" e "próximos passos", desmarca leituras que não quer mostrar e libera. Depois de liberado: texto pronto para o WhatsApp (copiar ou abrir no WhatsApp) e link `/r/{token}` que o cliente abre sem login. Só métricas de anúncio e atendimento.

## Falta
1. **IC Supra / WhatsApp e Meta Ads**: aguardando verificação da empresa na Meta. Depois: publicar o app (ícone em `docs/marca/orvya-icone-1024.png`), atribuir ativos ao usuário do sistema da IC, gerar os tokens (WhatsApp e anúncios), conectar em Canais (vaga 1) e Tráfego. Número inscrito e webhook já verificados.
2. **Google Ads**: IC conectada ("IC Supra Hospitalar NOVA") e sincronizando. LocPress: falta dar acesso de leitura ao contatoingridss@gmail.com e conectar em Tráfego.
3. **Rodar a migration 0018** no Supabase e clicar em "Atualizar agora" em cada conta de anúncios (a frequência e os criativos aparecem depois disso). Definir as metas de cada cliente.
4. **Instagram para clientes reais**: Análise do App na Meta (Acesso Avançado). Instagram da IC: seguir o passo a passo acima quando o app dela estiver liberado.
5. **Ida para produção (6/11)**: Vercel Pro, domínio `orvyacrm.com.br` (Registro.br; depois trocar URLs na Vercel, Supabase, Meta e Google Cloud), Resend (e-mail de sábado), anúncios da LocPress apontando para (86) 9432-0549. Depois: Supabase Pro ou backup semanal criptografado.
6. Formulários de anúncio da Meta (Lead Ads) e devolução de vendas para a Meta (API de Conversões).
7. Landing page do Orvya: em andamento numa conversa separada.
8. Fase 4 (IA): desligada por custo; pode voltar como triagem (Claude Haiku 5.5, de baixo custo).
