import { z } from "zod";
import { PLATFORM_PLANS } from "./plans";

export const billingChargeSchema = z.object({
  payerEmail: z.string().trim().email("Informe um e-mail válido.").max(200, "E-mail muito longo."),
  payerDocument: z.string().trim().min(11, "Informe um CPF ou CNPJ válido.").max(20, "Documento inválido."),
});

/**
 * Renovação (TASK-011): o formulário manda o plano escolhido, então ele
 * precisa ser validado contra a lista fechada ANTES de chegar ao banco —
 * o valor cobrado nunca vem do formulário, mas um `planCode` arbitrário
 * chegando à RPC viraria uma exceção crua de banco em vez de um erro de
 * campo legível. Derivado de PLATFORM_PLANS para nunca divergir dele.
 */
const PLAN_CODE_VALUES = PLATFORM_PLANS.map((plan) => String(plan.code)) as [string, ...string[]];

export const subscriptionRenewalSchema = billingChargeSchema.extend({
  planCode: z.enum(PLAN_CODE_VALUES, { message: "Escolha um plano válido." }),
});
