# Orvya — especificação funcional

## 1. Perfis de acesso

| Perfil | Quem | Onde fica |
|---|---|---|
| **Administrador** | Responsável pela plataforma | `profiles.is_platform_admin = true` |
| **Gestor** | Dono ou gerente de uma empresa (ex.: Sr. Ivo na IC Supra) | `memberships.role = 'gestor'` |
| **Vendedor** | Quem atende (ex.: Renato, Camila) | `memberships.role = 'vendedor'` |

Um usuário pode pertencer às duas empresas. O seletor de empresa só aparece para quem tem acesso a mais de uma.

### Matriz de permissões

| Ação | Admin | Gestor | Vendedor |
|---|---|---|---|
| Ver as duas empresas | ✅ | só as dele | só as dele |
| Ver leads | todos | todos da empresa | **os dele + sem responsável** |
| Pegar lead sem responsável | ✅ | ✅ | ✅ (vira dono) |
| Transferir lead para outro vendedor | ✅ | ✅ | ❌ |
| Mover etapa, editar lead, criar tarefa e anotação | ✅ | ✅ | nos dele |
| Excluir lead ou contato | ✅ | ✅ | ❌ |
| Ver conversas | todas | todas da empresa | **atribuídas a ele + fila sem responsável** |
| Responder conversa / enviar modelo | ✅ | ✅ | nas dele |
| Assumir conversa / devolver para IA | ✅ | ✅ | nas dele |
| Reativação em lote | ✅ | ✅ | ❌ |
| Catálogo | editar | editar | só consultar |
| Automações por etapa | editar | editar | ❌ (não vê a tela) |
| Funis, etapas e campos | editar | editar | ❌ |
| Números de WhatsApp, modelos de mensagem, integrações, configuração da IA | editar | ver | ❌ |
| Equipe (convidar, desativar, mudar perfil) | ✅ | ver | ❌ |
| Painel com números da equipe | ✅ | ✅ | ❌ (vê "Meu dia") |

Tudo isso é garantido pelo RLS em `supabase/migrations/0001_init.sql`. A interface só esconde o que o banco já bloqueia.

## 2. Autenticação

- Tela `/login`: e-mail e senha, link "Esqueci minha senha". Visual do protótipo: fundo escuro com brilho violeta, símbolo + "Orvya", slogan e assinatura "VÉR7ICE Orvya" no rodapé.
- Recuperação de senha por e-mail (Supabase Auth). Tela `/redefinir-senha`.
- **Não existe cadastro aberto.** Usuários entram por convite do administrador (`auth.admin.inviteUserByEmail` em server action) já com empresa e perfil definidos.
- Usuário desativado (`profiles.active = false`) perde acesso imediatamente (as funções de RLS checam `active`).
- Após login: admin → seletor de empresa; gestor/vendedor com uma empresa → direto para ela. Vendedor cai em **Meu dia**; admin e gestor caem no **Painel**.
- Sessão persistente; sair pelo menu do usuário.

## 3. Navegação por perfil

**Admin e gestor** (lateral, como no protótipo): Painel · Funil · Conversas · Precisa de mim · Tarefas · Catálogo · ── · Automações · Canais e integrações · Equipe · Agente de IA (as quatro últimas: gestor só leitura, exceto Automações que ele edita).

**Vendedor** (barra inferior no celular, lateral no desktop): **Meu dia** · Conversas · Meu funil · Tarefas · Catálogo (consulta).

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

### 4.4 Detalhe do lead (painel lateral)
Cabeçalho com empresa, funil/etapa, canal/número. Bloco do agente de IA (estado, score, resumo, assumir/devolver). Seção Negócio (funil, etapa, valor, temperatura, responsável, origem, tipo de cliente, canal, número da empresa, nome, telefone, instituição). Campos personalizados do funil (`custom_fields`). Produtos de interesse (do catálogo; na locação mostra preço mensal). Tarefas do lead. Histórico (`activities`) com campo de anotação. Rodapé: abrir conversa, marcar ganho, perdido, excluir (só gestor/admin).

Na LocPress, quando o lead entra em **Em locação**, abrir formulário de contrato (`rental_contracts`): equipamento, nº de série, início, fim, valor mensal, endereço.

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
- **Reativar leads parados**: filtro 2/5/7/14 dias, seleção, escolha do modelo aprovado, prévia por lead, custo total estimado, envio em fila com intervalo de 2 a 6 minutos entre mensagens (job no servidor).

### 4.7 Tarefas
Nova tarefa (título, lead, prazo, responsável — vendedor só cria para si). Grupos: Atrasadas, Hoje, Próximos dias, Concluídas. Filtro por responsável (gestor/admin).

### 4.8 Catálogo
Tabela pesquisável. IC Supra: código, produto, categoria, preço, estoque, campanha. LocPress: equipamento, categoria, preço de venda, aluguel por mês (vazio = só venda), estoque, em locação. Coluna "leads em aberto interessados". Campo `ai_notes` (informações que a IA pode usar: medidas, indicação de uso, garantia). Importação por planilha CSV (gestor/admin).

### 4.9 Automações
Regras por etapa (entrou na etapa X do funil Y → criar tarefa Z com prazo N dias para o responsável), com liga/desliga e exclusão. Bloco de regras fixas (informativo), como no protótipo.

### 4.10 Canais e integrações (admin edita, gestor vê)
- 2 cartões de número por empresa (slot 1 e 2): nome interno, telefone, status, qualidade, conversas iniciadas pelo cliente no mês, leads abertos, conectado há. Ações: conectar (Embedded Signup da Meta — fase 2; no MVP o admin cadastra `phone_number_id`, `waba_id` e token manualmente), renomear, desconectar.
- Modelos de mensagem: lista com categoria, status (sincronizado da Meta), custo estimado; criar modelo (envia para aprovação via Graph API).
- Integrações (fase 2): Meta Lead Ads, anúncios de clique para WhatsApp, API de Conversões, Google Ads formulários, Google Ads conversões, site, Instagram, Messenger.

### 4.11 Equipe (admin)
Lista de usuários por empresa com perfil e status. Convidar (nome, e-mail, empresa, perfil). Alterar perfil. Desativar/reativar.

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
