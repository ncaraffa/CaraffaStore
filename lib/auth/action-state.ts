/**
 * Estado inicial compartilhado para todo `useActionState` de formulário
 * de auth/onboarding. Vive fora de qualquer arquivo "use server" de
 * propósito: um arquivo "use server" só pode exportar funções async —
 * exportar uma constante objeto dali quebra em runtime ("A 'use server'
 * file can only export async functions, found object").
 */
export const IDLE_ACTION_STATE = { status: "idle" as const };
