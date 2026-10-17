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
- **Um app por empresa** (não somos Tech Provider): a IC Supra terá app próprio no Gerenciador dela. Pendente: `META_APP_SECRET` aceitar mais de uma chave (lista) para validar a assinatura dos dois apps.
- Verificação de empresa: **LocPress em análise**; **IC Supra bloqueada** (telefone do cartão CNPJ desatualizado — atualizar na Receita via contador ou enviar comprovante recente).

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

## Falta
1. Testes da 3b-2 e 3c em produção.
3. Aceitar várias `META_APP_SECRET`; app e número da IC Supra.
4. Fase 5 restante: domínio próprio, Vercel Pro, Supabase Pro, e-mail transacional, jobs agendados (renovação de contratos, sincronização de modelos).
5. Fase 4 (IA) e Fase 6 (integrações de anúncios e site) — sem data.
