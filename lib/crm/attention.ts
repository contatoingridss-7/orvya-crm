/**
 * Cliente esperando resposta há mais que isso entra em "Precisa de mim" e soma no
 * contador vermelho do menu. Regra da empresa: 5 minutos.
 */
export const WAIT_MINUTES = 5;

/** Acima disso o cronômetro fica vermelho. */
export const WAIT_CRITICAL_MINUTES = 15;

/** Tarefa vencida há mais que isso aparece para o gestor em "Precisa de mim". */
export const ESCALATE_HOURS = 24;
