"use server";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireStoreStatus } from "@/lib/tenant/access-control";
import { createPlatformBillingCharge, BillingCheckoutError } from "@/lib/billing/orchestration";
import { parseDocument } from "@/lib/payments/document";
import { subscriptionRenewalSchema } from "@/lib/billing/schemas";
import { messageForBillingError, FIELD_LEVEL_CODES } from "@/lib/billing/messages";
import { fieldErrorsFromZod } from "@/lib/auth/form-errors";
import type { PlanCode } from "@/lib/supabase/types";

export interface RenewSubscriptionState {
  status: "idle" | "error" | "success";
  message?: string;
  fieldErrors?: Record<string, string>;
}

/**
 * Renovação por iniciativa do lojista, com troca de plano opcional.
 * Equivalente de createBillingChargeAction (app/pending-payment/actions.ts)
 * para uma loja que JÁ está ativa — mesma orquestração, mesma RPC, mesma
 * idempotência; a diferença é só o `planCode` escolhido e o guard de
 * status ("active", não "pending_payment").
 *
 * Duas coisas que esta action deliberadamente NÃO faz:
 *
 * - não altera `store_plans`: o plano escolhido viaja na cobrança e só
 *   passa a valer quando o Pix é aprovado (billing_charge_apply_provider_state,
 *   0011_subscription_management.sql). Clicar em "Profissional" sem pagar
 *   não muda plano nenhum.
 * - não toca em nada da loja: renovar não reseta catálogo, pedidos nem
 *   configurações. Uma renovação aprovada numa loja `active` só estende
 *   `period_end` — nenhum efeito colateral em `stores`.
 *
 * `storeId` nunca vem do formulário: sempre resolvido de novo por
 * requireStoreStatus (sessão + RLS).
 */
export async function renewSubscriptionAction(
  _prev: RenewSubscriptionState,
  formData: FormData,
): Promise<RenewSubscriptionState> {
  const parsed = subscriptionRenewalSchema.safeParse({
    payerEmail: String(formData.get("payerEmail") ?? ""),
    payerDocument: String(formData.get("payerDocument") ?? ""),
    planCode: String(formData.get("planCode") ?? ""),
  });
  if (!parsed.success) {
    return { status: "error", fieldErrors: fieldErrorsFromZod(parsed.error) };
  }

  const document = parseDocument(parsed.data.payerDocument);
  if (!document) {
    return { status: "error", fieldErrors: { payerDocument: "Informe um CPF ou CNPJ válido." } };
  }

  const storeSlug = String(formData.get("storeSlug") ?? "") || undefined;
  const supabase = await createServerSupabaseClient();
  const { store } = await requireStoreStatus(supabase, "active", storeSlug);

  try {
    await createPlatformBillingCharge({
      storeId: store.id,
      payerEmail: parsed.data.payerEmail,
      payerDocType: document.type,
      payerDocNumber: document.digits,
      planCode: Number(parsed.data.planCode) as PlanCode,
    });
  } catch (error) {
    if (error instanceof BillingCheckoutError) {
      const message = messageForBillingError(error);
      const fieldName = FIELD_LEVEL_CODES[error.code];
      return fieldName ? { status: "error", fieldErrors: { [fieldName]: message } } : { status: "error", message };
    }
    return { status: "error", message: "Não foi possível concluir. Tente novamente." };
  }

  return { status: "success" };
}
