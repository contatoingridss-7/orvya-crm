-- =====================================================================
-- Orvya — fila de envio (Fase 3c): reativação de leads parados em lote.
-- A tela "Precisa de mim" agenda um modelo aprovado por lead, com 2 a 6 minutos
-- entre as mensagens; a rota /api/jobs/fila-envio (chamada pelo pg_cron) envia.
-- Pode ser executado mais de uma vez.
-- =====================================================================

create table if not exists public.outbound_queue (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies (id) on delete cascade,
  conversation_id  uuid not null references public.conversations (id) on delete cascade,
  lead_id          uuid references public.leads (id) on delete cascade,
  template_id      uuid not null references public.message_templates (id) on delete cascade,
  params           text[] not null default '{}',     -- valores de {{1}}, {{2}}... já preenchidos
  scheduled_at     timestamptz not null,
  status           text not null default 'pendente'
                   check (status in ('pendente', 'enviando', 'enviado', 'falhou', 'cancelado')),
  attempts         int not null default 0,
  error            text,                              -- motivo em português (falha ou cancelamento automático)
  created_by       uuid references public.profiles (id) on delete set null,
  sent_message_id  uuid references public.messages (id) on delete set null,
  locked_at        timestamptz,                       -- quando o job pegou o item (detecta envio interrompido)
  created_at       timestamptz not null default now()
);

create index if not exists outbound_queue_due_idx on public.outbound_queue (status, scheduled_at);
create index if not exists outbound_queue_company_idx on public.outbound_queue (company_id, created_at desc);
create index if not exists outbound_queue_lead_idx on public.outbound_queue (lead_id) where status = 'pendente';

alter table public.outbound_queue enable row level security;

-- Gestor/admin da empresa leem a fila e só podem cancelar o que ainda está pendente.
-- Inserção e processamento: só o servidor (service_role, que ignora o RLS).
drop policy if exists outbound_queue_select on public.outbound_queue;
create policy outbound_queue_select on public.outbound_queue for select to authenticated
  using (public.is_company_manager(company_id));

drop policy if exists outbound_queue_cancel on public.outbound_queue;
create policy outbound_queue_cancel on public.outbound_queue for update to authenticated
  using (public.is_company_manager(company_id) and status = 'pendente')
  with check (public.is_company_manager(company_id) and status = 'cancelado');

-- Usuário só altera a coluna status (o RLS acima limita a 'pendente' → 'cancelado').
revoke all on public.outbound_queue from anon, authenticated;
grant select on public.outbound_queue to authenticated;
grant update (status) on public.outbound_queue to authenticated;
grant all on public.outbound_queue to service_role;

-- Pega até p_limit itens vencidos e marca como 'enviando' de forma atômica.
-- "for update skip locked": duas execuções ao mesmo tempo nunca pegam o mesmo item.
create or replace function public.claim_outbound_queue(p_limit int default 10)
returns setof public.outbound_queue language sql security invoker set search_path = '' as $$
  update public.outbound_queue q
  set status = 'enviando', attempts = q.attempts + 1, locked_at = now()
  where q.id in (
    select i.id from public.outbound_queue i
    where i.status = 'pendente' and i.scheduled_at <= now()
    order by i.scheduled_at
    limit greatest(1, least(p_limit, 50))
    for update skip locked
  )
  and q.status = 'pendente'
  returning q.*;
$$;

revoke execute on function public.claim_outbound_queue(int) from public, anon, authenticated;
grant execute on function public.claim_outbound_queue(int) to service_role;
