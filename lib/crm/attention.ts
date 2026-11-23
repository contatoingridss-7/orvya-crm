/**
 * Cliente esperando resposta há mais que isso entra em "Precisa de mim" e soma no
 * contador vermelho do menu. Regra da empresa: 5 minutos.
 */
export const WAIT_MINUTES = 5;

/** Acima disso o cronômetro fica vermelho. */
export const WAIT_CRITICAL_MINUTES = 15;

/** Tarefa vencida há mais que isso aparece para o gestor em "Precisa de mim". */
export const ESCALATE_HOURS = 24;

/**
 * Conversa de lead já fechado (venda ou perda) não espera resposta: fica em "Finalizadas".
 * Sem lead ligado, a conversa continua valendo. Se o cliente escrever de novo, abre lead novo.
 */
export const hasOpenLead = (c: { leads: { closed_at: string | null } | null }) => !c.leads?.closed_at;
