# Como começar no Claude Code

## Antes de abrir o Claude Code (15 minutos)

1. Criar o projeto no **Supabase** (região São Paulo). Plano gratuito serve para construir; mude para o Pro antes de ligar números reais (o gratuito pausa após uma semana sem uso).
2. Anotar: URL do projeto, `anon key`, `service_role key`.
3. Criar conta na **Vercel** e um repositório vazio no **GitHub** chamado `orvya`.
4. Criar a chave no **Console da Anthropic** (de preferência um workspace por empresa).
5. Criar o **app na Meta** com o produto WhatsApp e pegar o **número de teste** (ver `docs/WHATSAPP.md`, seção 1). Disparar já a verificação das empresas no Gerenciador de Negócios, que pode levar dias.
6. Descompactar este pacote numa pasta vazia, abrir a pasta no Claude Code.

## Prompt inicial (cole no Claude Code)

```
Leia CLAUDE.md e todos os arquivos em docs/ antes de começar. Abra docs/prototipo/orvya-prototipo.html
para entender o visual e o comportamento esperado: ele é a referência aprovada pelo cliente.

Vamos construir o Orvya seguindo as fases de KICKOFF.md, uma por vez. Ao fim de cada fase:
rode typecheck e lint, me mostre o que testar e espere meu ok antes de seguir.

Comece pela Fase 0.
```

## Fases

### Fase 0 — Base (≈ 30 min)
- Next.js 15 + TypeScript + Tailwind, ESLint, estrutura de pastas do CLAUDE.md.
- Tokens de design do protótipo em CSS (claro/escuro), fonte, componentes base (botão, campo, pill, painel, modal, painel lateral, aviso).
- Clientes Supabase (navegador, servidor, admin) e middleware de sessão.
- Aplicar `supabase/migrations/0001_init.sql` e `supabase/seed.sql`.
- `.env.local` a partir de `.env.example`.
**Teste:** app abre, alterna claro/escuro, tabelas e dados iniciais aparecem no Supabase.

### Fase 1 — Login e perfis (≈ 45 min)
- Telas de login, esqueci a senha e redefinir senha com a marca Orvya.
- Layout autenticado com lateral (admin/gestor) e barra inferior no celular (vendedor), seletor de empresa.
- Tela Equipe (admin): convidar por e-mail com empresa e perfil, mudar perfil, desativar.
- Tornar seu usuário administrador (comando no fim de `seed.sql`).
**Teste:** crie um gestor e um vendedor de teste; cada um vê só o que a matriz da SPEC permite.

### Fase 2 — CRM (≈ 2 h)
- Funil (kanban com arrastar e soltar), detalhe do lead, modal de motivo de perda, novo lead.
- Tarefas, Catálogo (com importação CSV), Automações.
- Meu dia (vendedor) e Painel (admin/gestor).
- Contratos de locação na LocPress.
**Teste:** mover etapa cria tarefas das automações; vendedor pega lead da fila; perda exige motivo.

### Fase 3 — WhatsApp (≈ 2 h)
- Tela Canais: cadastro manual de `phone_number_id`, `waba_id`, telefone e token por número (2 por empresa).
- Webhook (verificação, assinatura, idempotência, mídia no Storage, status).
- Caixa de conversas com Realtime, envio de texto, janela de 24 h, modelos (cadastro, envio à Meta, sincronização de status, envio fora da janela).
- Reativação em lote em Precisa de mim.
**Teste:** com o número de teste da Meta, siga a lista de `docs/WHATSAPP.md`, seção 7.

### Fase 4 — Agente de IA (≈ 1 h 30)
- Tela Agente de IA, montagem de contexto, ferramentas, agrupamento de mensagens, trava, limites.
- Resumo e score com o modelo de apoio.
- Testar agente (simulação).
**Teste:** conversa normal; pedido de desconto passa para humano; urgência de alta hospitalar passa para humano; equipe responde e a IA pausa.

### Fase 5 — Publicação (≈ 30 min)
- Deploy na Vercel com as variáveis de ambiente; domínio.
- Atualizar a URL do webhook na Meta para o domínio publicado.
- Job diário de contratos vencendo e sincronização de modelos (Vercel Cron).
**Teste:** fluxo completo em produção com o número de teste.

### Fase 6 — Integrações (depois)
Seguir `docs/INTEGRACOES.md`.

## O que depende de terceiros (não trava o desenvolvimento)

| Item | Quem | Prazo típico |
|---|---|---|
| Verificação do Gerenciador de Negócios de cada empresa | Meta | alguns dias |
| Nome de exibição de cada número | Meta | horas a dias |
| Aprovação dos modelos de mensagem | Meta | minutos a 1 dia |
| Permissão de leitura de leads (Lead Ads) | Meta | dias |
| Token de desenvolvedor do Google Ads | Google | dias |

## Pendências de conteúdo com os clientes

- Tabela de preços aprovada (IC Supra: Sr. Ivo; LocPress: responsável).
- Formas de pagamento, regras de entrega e horários de cada empresa (entram no prompt da IA).
- Lista da equipe com e-mail e perfil.
- Textos finais dos modelos de mensagem.
