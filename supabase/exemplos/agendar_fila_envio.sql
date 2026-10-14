-- =====================================================================
-- Orvya — disparo da fila de envio a cada minuto (pg_cron + pg_net do Supabase)
--
-- Por que aqui e não na Vercel: no plano gratuito (Hobby) a Vercel só permite cron
-- diário. O vercel.json tem um cron diário apenas de segurança; o disparo de verdade
-- é este, que chama a rota /api/jobs/fila-envio a cada minuto.
--
-- Como usar (uma vez, no SQL Editor do Supabase):
--   1. Gere um segredo longo (ex.: no terminal: openssl rand -hex 32) e cadastre na
--      Vercel como variável de ambiente CRON_SECRET (Production). Faça um novo deploy.
--   2. Rode a migration supabase/migrations/0008_fila_envio.sql (se ainda não rodou).
--   3. Copie este arquivo para o SQL Editor, troque COLE_AQUI_O_CRON_SECRET pelo mesmo
--      segredo e execute. NÃO salve o arquivo com o segredo no repositório.
--   4. Confira: select * from cron.job;  e, depois de 1 ou 2 minutos,
--      select * from cron.job_run_details order by start_time desc limit 5;
--      select id, status_code, created from net._http_response order by created desc limit 5;
--      (status_code 200 = a rota respondeu; 401 = segredo diferente; 503 = CRON_SECRET não cadastrado)
-- =====================================================================

-- Extensões (também podem ser ligadas em Database → Extensions)
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Se já existir um agendamento com o mesmo nome, cron.schedule substitui.
select cron.schedule(
  'orvya-fila-envio',
  '* * * * *',
  $$ select net.http_post(
       url := 'https://orvya-crm.vercel.app/api/jobs/fila-envio',
       headers := jsonb_build_object('Authorization', 'Bearer COLE_AQUI_O_CRON_SECRET', 'Content-Type', 'application/json'),
       body := '{}'::jsonb
     ) $$
);

-- Para parar o disparo (ex.: trocar o segredo ou o domínio), rode:
--   select cron.unschedule('orvya-fila-envio');
-- e depois agende de novo com o bloco acima.
