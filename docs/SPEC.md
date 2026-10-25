# Orvya — especificação funcional

## 1. Perfis de acesso

| Perfil | Quem | Onde fica |
|---|---|---|
| **Administrador** | Responsável pela plataforma | `profiles.is_platform_admin = true` |
| **Gestor** | Dono ou gerente de uma empresa (ex.: Sr. Ivo na IC Supra) | `memberships.role = 'gestor'` |
| **Vendedor** | Quem atende (ex.: Renato, Camila) | `memberships.role = 'vendedor'` |
| **Expedição** | Separação, faturamento e entrega | `memberships.role = 'logistica'` |

Um usuário pode pertencer às duas empresas. O seletor de empresa só aparece para quem tem acesso a mais de uma.

**Vendedor restrito a funis:** `memberships.pipeline_ids` (vazio = todos). Ex.: na IC Supra, a Thays só trabalha no funil CPAP: vê só os leads desse funil, a fila de conversas ligadas a leads dele e as tarefas desses leads. O administrador define em Equipe.

### Matriz de permissões

| Ação | Admin | Gestor | Vendedor | Expedição |
|---|---|---|---|---|
| Ver as duas empresas | ✅ | só as dele | só as dele | só as dele |
| Ver leads | todos | todos da empresa | **os dele + sem responsável** (só nos funis liberados) | ❌ (só os pedidos agendados, pela tela Expedição) |
| Pegar lead sem responsável | ✅ | ✅ | ✅ (vira dono) | ❌ |
| Transferir lead para outro vendedor | ✅ | ✅ | ❌ | ❌ |
| Mover etapa, editar lead, criar tarefa e anotação | ✅ | ✅ | nos dele | ❌ |
| Agendar entrega / adaptação (data, hora, endereço) | ✅ | ✅ | nos dele | ❌ |
| Excluir lead ou contato | ✅ | ✅ | ❌ | ❌ |
| Ver conversas | todas | todas da empresa | **atribuídas a ele + fila sem responsável** | ❌ |
| Responder conversa / enviar modelo | ✅ | ✅ | nas dele | ❌ |
| Assumir conversa / devolver para IA | ✅ | ✅ | nas dele | ❌ |
| Reativação em lote | ✅ | ✅ | ❌ | ❌ |
| Expedição: ver pedidos agendados e avançar status | ✅ | ✅ | ❌ | ✅ |
| Catálogo | editar | editar | só consultar | consultar + **fotos** |
| Automações por etapa | editar | editar | ❌ (não vê a tela) | ❌ |
| Funis, etapas e campos | editar | editar | ❌ | ❌ |
| Números de WhatsApp, modelos de mensagem, integrações, configuração da IA | editar | ver | ❌ | ❌ |
| Equipe (convidar, desativar, mudar perfil, funis do vendedor) | ✅ | ver | ❌ | ❌ |
| Painel e Relatórios | ✅ | ✅ | ❌ (vê "Meu dia") | ❌ |

Tudo isso é garantido pelo RLS em `supabase/migrations/0001_init.sql` e `0009_logistica_cpap.sql`. A interface só esconde o que o banco já bloqueia.

A expedição **não** tem acesso direto a leads, contatos, conversas, tarefas nem campos do funil (receita, médico, pressão). A tela Expedição usa a função `logistics_orders`, que devolve só cliente, telefone, endereço, data/hora, observação, produtos e quantidades. O avanço de status passa por `logistics_set_status`.

## 2. Autenticação

- Tela `/login`: e-mail e senha, link "Esqueci minha senha". Visual do protótipo: fundo escuro com brilho violeta, símbolo + "Orvya", slogan e assinatura "VÉR7ICE Orvya" no rodapé.
- Recuperação de senha por e-mail (Supabase Auth). Tela `/redefinir-senha`.
- **Não existe cadastro aberto.** Usuários entram por convite do administrador (`auth.admin.inviteUserByEmail` em server action) já com empresa e perfil definidos.
- Usuário desativado (`profiles.active = false`) perde acesso imediatamente (as funções de RLS checam `active`).
- Após login: admin → seletor de empresa; gestor/vendedor com uma empresa → direto para ela. Vendedor cai em **Meu dia**; expedição cai em **Expedição**; admin e gestor caem no **Painel**.
- Sessão persistente; sair pelo menu do usuário.

## 3. Navegação por perfil

**Admin e gestor** (lateral, como no protótipo): Painel · Funil · Conversas · Precisa de mim · Tarefas · Catálogo · Expedição · Relatórios · ── · Automações · Canais e integrações · Equipe · Agente de IA (as quatro últimas: gestor só leitura, exceto Automações que ele edita).

**Vendedor** (barra inferior no celular, lateral no desktop): **Meu dia** · Conversas · Meu funil · Tarefas · Catálogo (consulta).

**Expedição** (barra inferior no celular): **Expedição** · Catálogo (consulta + fotos).

## 4. Telas

### 4.1 Meu dia (vendedor)
- Saudação com nome e data.
- **Conversas esperando resposta** (as dele, ordenadas por tempo de espera).
- **Fila sem responsável**: contatos novos que ninguém pegou, com botão **Pegar**. Ao pegar: `leads.owner_id` e `conversations.assigned_to` = ele, registro em `activities`.
- **Tarefas de hoje e atrasadas** com check para concluir.
- **Leads parados** (dele, sem contato há 7+ dias) com atalho para a conversa.
- Indicadores pessoais do mês: leads ganhos, valor fechado, conversão.

### 4.2 Painel (admin/gestor)
Igual ao protótipo: 5 indicadores, funil por etapa (todos os funis), origem dos leads (ganhos/perdidos/abertos por origem), precisa de atenção, contratos de locação vencendo em 30 dias (LocPress), status dos números de WhatsApp com contador de conversas iniciadas pelo cliente no mês (referência: 1.000 sem custo por número). Filtro por vendedor e período.

### 4.3 Funil (kanban)
- Abas por funil da empresa. Filtros: responsável, temperatura, origem, busca.
- Colunas = etapas, com contagem e soma de valor. Arrastar e soltar (dnd-kit) e, no celular, mudar etapa pelo detalhe do lead.
- Card: nome, empresa/instituição, canal e número, valor, temperatura, B2B, IA ativa/humano, "precisa de você", tarefa atrasada, "vence em X dias" (locação), responsável, último contato.
- Soltar em etapa de perda abre o modal de motivo (lista `lost_reasons` + texto livre).
- Mudança de etapa: o banco grava a atividade e cria as tarefas das automações (trigger). A tela mostra aviso de cada tarefa criada.
- Card mostra **Tarefa atrasada** (vermelho) e **Tarefa para hoje** (amarelo), que servem de alerta para os follow-ups.
- **Etapas da expedição** (`stages.logistics`): "Entrega agendada" (antes do ganho nos funis de venda, locação e CPAP) e "Adaptação programada" (teste in loco do CPAP). Mover para elas abre o agendamento: data e hora, endereço e observação para a expedição. Sem agendamento o lead não entra na etapa. O card mostra data e status da expedição.

### 4.4 Detalhe do lead (painel lateral)
Cabeçalho com empresa, funil/etapa, canal/número. Bloco do agente de IA (estado, score, resumo, assumir/devolver). Seção Negócio (funil, etapa, valor, temperatura, responsável, origem, tipo de cliente, canal, número da empresa, nome, telefone, instituição). Campos personalizados do funil (`custom_fields`). Produtos de interesse (do catálogo; na locação mostra preço mensal). Tarefas do lead. Histórico (`activities`) com campo de anotação. Rodapé: abrir conversa, marcar ganho, perdido, excluir (só gestor/admin).

Na LocPress, quando o lead entra em **Em locação**, abrir formulário de contrato (`rental_contracts`): equipamento, nº de série, início, fim, valor mensal, endereço.

Em etapa da expedição: bloco **Entrega/Adaptação com a expedição** com data, endereço, observação e andamento (Agendado → Separado → Faturado → Saiu para entrega → Entregue); botão Reagendar (volta o status para Agendado).

### 4.5 Conversas
- Lista à esquerda com filtro por número/canal, busca e etiquetas (precisa de você, IA respondendo, aguardando resposta). Thread à direita. No celular, uma coluna por vez.
- Cabeçalho: contato, telefone, número da empresa, etapa; Assumir conversa / Devolver para IA; Ver lead.
- Resumo da IA no topo da thread.
- Bolhas: cliente, IA, equipe (com nome), modelo (marcado), sistema. Status de entrega (enviado, entregue, lido, falhou) nas mensagens de saída.
- Mídia: imagem com miniatura, áudio com player, documento com download (URL assinada).
- **Compositor conforme a janela de 24 h**:
  - Janela aberta: texto livre + anexo; aviso "Janela aberta até HH:MM".
  - Janela fechada: seletor de modelo aprovado, prévia preenchida, custo estimado, botão Enviar modelo.
  - Número não conectado: compositor bloqueado com aviso.
- Atualização ao vivo via Supabase Realtime (mensagens, status, novas conversas).

### 4.6 Precisa de mim (admin/gestor)
- Conversas com `needs_human = true`, ordenadas por score e espera, com motivo e resumo. Botão Assumir (atribui a quem clicou, se vendedor; gestor pode escolher o vendedor).
- **Sem resposta da equipe**: última mensagem do cliente há mais de **5 minutos** (regra da empresa). Cada item tem **cronômetro** de espera (amarelo a partir de 5 min, vermelho a partir de 15). A lista se atualiza a cada 30 s e o contador vermelho do menu soma esses alertas.
- **Tarefas atrasadas da equipe**: vencidas há mais de 1 dia, com o responsável; o gestor conclui, adia ou exclui dali. Somam no contador do menu.
- **Reativar leads parados**: filtro 2/5/7/14 dias, seleção, escolha do modelo aprovado, prévia por lead, custo total estimado, envio em fila com intervalo de 2 a 6 minutos entre mensagens (job no servidor).

### 4.7 Tarefas
Nova tarefa (título, lead, prazo, responsável — vendedor só cria para si). Um lead pode ter quantas tarefas forem necessárias. Grupos: Atrasadas, Hoje, Próximos dias, Concluídas. Filtro por responsável (gestor/admin).

### 4.7.1 Relatórios (admin/gestor)
Visão geral para a gestão: tarefas concluídas (e % no prazo), criadas (por automação ou pela equipe), atrasadas agora, próximos 7 dias, entregas concluídas; barras por pessoa; lista das atrasadas mais antigas. Períodos: 7 dias, este mês, mês passado, 30 dias. **Baixar PDF** (impressão do navegador). **E-mail todo sábado às 8h** (`/api/jobs/relatorio-semanal`, cron da Vercel) para gestores e administradores de cada empresa, com os últimos 7 dias — só números por pessoa, sem nomes de pacientes nem títulos de tarefa (LGPD). Botão "Enviar e-mail de teste" manda só para quem clicou.

### 4.7.1b Tráfego (só administrador da plataforma)
Contas de anúncio por empresa (Meta; Google Ads depois do token de desenvolvedor), conectadas com o token do usuário do sistema (`ads_read`), guardado em `ad_credentials` (só servidor). A API de Marketing é só lida: o Orvya não cria, pausa nem altera campanhas. Atualiza às 6h e às 13h (`/api/jobs/trafego`) e no botão "Atualizar agora".
Tela `trafego/`: períodos Hoje, Ontem, 7 dias, 30 dias, este mês, mês passado; esta empresa ou todas. Indicadores: investimento, leads dos anúncios que chegaram no Orvya, **CPL real**, vendas, **custo por venda**, faturamento e **ROAS** (o lead do anúncio de clique para o WhatsApp é ligado à campanha pelo anúncio de origem, `ad_ads`), além de cliques, CTR, CPC e o que a Meta conta. Gráficos diários separados de investimento e de leads (sem eixo duplo). Tabela de campanhas com o logotipo da plataforma. **Alertas**: conta desativada ou com pagamento pendente, saldo (pré-paga) ou limite de gastos para menos de N dias pelo gasto médio dos últimos 7 dias ("emitir boleto ou PIX para o cliente"), falha de atualização. **Baixar relatório** em PDF com a marca VÉR7ICE.

### 4.7.2 Expedição (admin, gestor, expedição)
Pedidos agendados agrupados em Atrasados, Hoje, Amanhã, Próximos dias e Entregues (7 dias), com filtro Entregas / Adaptações in loco. Cartão: cliente, data e hora, funil e vendedor, endereço (abrir no mapa), telefone (ligar), observação, produtos com foto, código e quantidade, andamento. Botão para o próximo status; "Confirmar entrega" pede confirmação. Ao entregar: o histórico do lead registra, as automações "ao entregar" criam tarefas e, na etapa Entrega agendada, o lead vai para a etapa de ganho. Na adaptação in loco o lead continua na etapa (o vendedor segue com o resultado do teste).

### 4.8 Catálogo
Tabela pesquisável, com miniatura da foto. **Fotos**: gestor, admin e expedição incluem, trocam e removem pelo celular (câmera ou galeria; reduzida no aparelho para 1200 px). Ficam no bucket público `product-photos/{company_id}/` para poderem ser enviadas ao cliente. IC Supra: código, produto, categoria, preço, estoque, campanha. LocPress: equipamento, categoria, preço de venda, aluguel por mês (vazio = só venda), estoque, em locação. Coluna "leads em aberto interessados". Campo `ai_notes` (informações que a IA pode usar: medidas, indicação de uso, garantia). Importação por planilha CSV (gestor/admin).

### 4.9 Automações
Regras por etapa (entrou na etapa X do funil Y → criar tarefa Z com prazo N dias para o responsável), com liga/desliga e exclusão. Em etapas da expedição, a regra pode ser **"ao entregar"** (`automation_rules.trigger_event = 'delivered'`): a tarefa nasce quando a expedição confirma a entrega. Já vem configurado o **follow-up do CPAP** (IC Supra e LocPress): 24 h, 7 dias e 15 dias após a entrega. Bloco de regras fixas (informativo), como no protótipo.
- **Parado na etapa** (`trigger_event = 'stale'`, `after_days`): lead há N dias na mesma etapa (`leads.stage_entered_at`) vira tarefa para o responsável, uma vez por entrada na etapa. Função `run_stale_automations()`, rodada pelo pg_cron de hora em hora e pelo cron diário da Vercel (`/api/jobs/automacoes`). Vem configurado para Novo contato (1 dia), Orçamento (3), Negociação (5), Cotação (5), Documentação (2), Receita e avaliação e Proposta do CPAP (3).
- **Repetição** (`repeat_days`): ao concluir a tarefa da regra, nasce a próxima (se o lead não foi perdido). Usado na **reposição de consumíveis do CPAP**: filtro a cada 30 dias e máscara a cada 90, a partir da entrega.
- **Tarefas prontas** (`task_templates`): frases pré-cadastradas por funil (ou para todos). Aparecem como lista em "O que precisa ser feito" na tela Tarefas e no detalhe do lead, filtradas pelo funil do lead; ao escolher, o texto é preenchido e pode ser editado. O prazo é sempre escolhido pelo atendente. Gestor e admin cadastram, escondem e excluem.

### 4.10 Canais e integrações (admin edita, gestor vê)
- 2 cartões de número por empresa (slot 1 e 2): nome interno, telefone, status, qualidade, conversas iniciadas pelo cliente no mês, leads abertos, conectado há. Ações: conectar (Embedded Signup da Meta — fase 2; no MVP o admin cadastra `phone_number_id`, `waba_id` e token manualmente), renomear, desconectar.
- Modelos de mensagem: lista com categoria, status (sincronizado da Meta), custo estimado; criar modelo (envia para aprovação via Graph API).
- Integrações (fase 2): Meta Lead Ads, anúncios de clique para WhatsApp, API de Conversões, Google Ads formulários, Google Ads conversões, site, Instagram, Messenger.

### 4.11 Equipe (admin)
Lista de usuários por empresa com perfil e status. Convidar (nome, e-mail, empresa, perfil: gestor, vendedor ou expedição). Alterar perfil. Funis do vendedor (todos ou só os escolhidos). Desativar/reativar.

### 4.12 Agente de IA (admin edita, gestor vê)
Por empresa: ligado/desligado, horário de atendimento, modelo de resposta e de apoio, instruções da empresa (tom, políticas, formas de pagamento, entrega, desconto máximo que pode oferecer = 0 por padrão), gatilhos de passagem para humano. Botão "Testar agente" com conversa simulada.

## 5. Fluxos principais

### 5.1 Mensagem recebida no WhatsApp
1. Webhook valida assinatura, grava `webhook_events`, responde 200.
2. Identifica a empresa e o número por `phone_number_id`.
3. Busca ou cria o **contato** por telefone (E.164) na empresa.
4. Busca ou cria a **conversa** (contato + número). Atualiza `last_inbound_at`, `last_message_at`, `unread_count`.
5. Se não há lead aberto para o contato na empresa: cria lead na primeira etapa do **funil padrão do número** (`whatsapp_numbers.default_pipeline_id`), sem responsável, origem = "Meta Ads" se a mensagem trouxer `referral` de anúncio, senão "WhatsApp direto". Guarda `referral` em `leads.ad_referral`.
6. Grava a mensagem (idempotente por `wa_message_id`). Mídia: baixa e salva no Storage.
7. Se `ai_enabled` e não `needs_human` e dentro do horário: dispara o agente (ver `AGENTE_IA.md`), agrupando mensagens que chegarem em sequência (espera de ~8 s).

### 5.2 Passagem para humano
A IA chama a ferramenta `pedir_humano(motivo)` → `needs_human = true`, motivo, resumo atualizado, aparece em Precisa de mim e notifica (Realtime) o responsável ou os gestores se não houver responsável. A IA responde ao cliente que alguém da equipe vai continuar.

### 5.3 Pessoa da equipe responde
Envio pelo servidor (`/api/whatsapp/send`) → checa permissão e janela → chama a Meta → grava a mensagem com `sender = 'user'` → `ai_enabled = false`, `needs_human = false`, `assigned_to` = quem respondeu se estava vazio.

### 5.4 Contratos de locação
Job diário (Vercel Cron ou `pg_cron`): contratos `ativo` com `end_date` em 30, 15 e 7 dias → cria tarefa "Oferecer renovação" para o responsável (uma vez por marco).

### 5.5 Status de entrega e custo
Webhook de `statuses` atualiza `messages.status`, `error` e `pricing` (categoria cobrada). O painel soma o custo estimado do mês por número.
