-- =====================================================================
-- Orvya — Prazo de tarefa automática em horas e follow-ups de venda da IC Supra.
--
-- Regra comercial (31/10/2026): retorno de orçamento, proposta e cotação no máximo 2 horas
-- depois do envio; nada de acompanhamento de venda com mais de 24 horas (a venda costuma
-- fechar nesse meio-tempo). Pós-venda, acompanhamento de CPAP e reposição continuam em dias.
--
-- - automation_rules.due_in_hours: quando preenchido, a tarefa vence em N horas (vale sobre due_in_days).
--   Aplicado por gatilho na criação da tarefa, para todas as origens (etapa, parado, entrega).
-- Pode ser executado mais de uma vez.
-- =====================================================================

alter table public.automation_rules
  add column if not exists due_in_hours int check (due_in_hours between 1 and 72);

create or replace function public.tasks_rule_due_hours()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_hours int;
begin
  if new.automation_rule_id is not null then
    select due_in_hours into v_hours from public.automation_rules where id = new.automation_rule_id;
    if v_hours is not null then
      new.due_at := now() + make_interval(hours => v_hours);
    end if;
  end if;
  return new;
end $$;

drop trigger if exists tasks_rule_due_hours on public.tasks;
create trigger tasks_rule_due_hours before insert on public.tasks
  for each row execute function public.tasks_rule_due_hours();

-- ---------------------------------------------------------------------
-- IC Supra: follow-ups de venda
-- ---------------------------------------------------------------------
-- Ao entrar em Orçamento enviado / Cotação enviada / Proposta: retorno em 2 horas.
update public.automation_rules r
set due_in_hours = 2, due_in_days = 0,
    task_title = case p.key
      when 'varejo' then 'Retorno do orçamento: falar com o cliente até 2 h após o envio'
      when 'b2b'    then 'Retorno da cotação: confirmar recebimento até 2 h após o envio'
      else               'Retorno da proposta de CPAP: falar com o paciente até 2 h após o envio'
    end
from public.stages s, public.pipelines p, public.companies c
where r.stage_id = s.id and r.pipeline_id = p.id and r.company_id = c.id
  and c.slug = 'ic-supra' and r.trigger_event = 'stage'
  and ((p.key = 'varejo' and s.name = 'Orçamento enviado')
    or (p.key = 'b2b' and s.name = 'Cotação enviada')
    or (p.key = 'cpap' and s.name = 'Proposta'));

-- Parado na etapa: no máximo 1 dia (a rotina diária cria a tarefa na manhã seguinte).
update public.automation_rules r
set after_days = 1, due_in_days = 0,
    task_title = case
      when p.key = 'varejo' and s.name = 'Orçamento enviado' then 'Orçamento sem resposta desde ontem: última tentativa e marcar ganho ou perdido'
      when p.key = 'varejo' and s.name = 'Negociação'        then 'Negociação parada desde ontem: propor o fechamento'
      when p.key = 'b2b'    and s.name = 'Cotação enviada'   then 'Cotação parada desde ontem: falar com o comprador'
      when p.key = 'cpap'   and s.name = 'Proposta'          then 'Proposta de CPAP sem resposta desde ontem: retomar o contato'
      when p.key = 'cpap'   and s.name = 'Receita e avaliação' then 'Receita e avaliação paradas desde ontem: cobrar a receita'
      else r.task_title
    end
from public.stages s, public.pipelines p, public.companies c
where r.stage_id = s.id and r.pipeline_id = p.id and r.company_id = c.id
  and c.slug = 'ic-supra' and r.trigger_event = 'stale' and r.after_days > 1
  and ((p.key = 'varejo' and s.name in ('Orçamento enviado', 'Negociação'))
    or (p.key = 'b2b' and s.name = 'Cotação enviada')
    or (p.key = 'cpap' and s.name in ('Proposta', 'Receita e avaliação')));
