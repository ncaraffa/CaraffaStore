"use server";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireStoreStatus } from "@/lib/tenant/access-control";
import { createPlatformBillingCharge, BillingCheckoutError } from "@/lib/billing/orchestration";
import { parseDocument } from "@/lib/payments/document";
import { billingChargeSchema } from "@/lib/billing/schemas";
import { messageForBillingError, FIELD_LEVEL_CODES } from "@/lib/billing/messages";
import { fieldErrorsFromZod } from "@/lib/auth/form-errors";

export interface BillingChargeState {
  status: "idle" | "error" | "success";
  message?: string;
  fieldErrors?: Record<string, string>;
}

/**
 * Gera (ou reaproveita) a cobrança Pix da assinatura da loja logada —
 * nunca aceita storeId do formulário: sempre resolvido de novo por
 * requireStoreStatus (sessão + RLS), exatamente como toda outra Server
 * Action protegida deste app.
 *
 * TASK-010: reaproveitada por duas telas — /pending-payment (primeira
 * cobrança da loja) e /suspended quando a suspensão é por billing_overdue
 * (pagar de novo reativa, ver billing_charge_apply_provider_state). Por
 * isso aceita os dois status aqui; a granularidade fina — suspended só
 * quando suspension_reason=billing_overdue, nunca platform_admin — é
 * responsabilidade de billing_charge_upsert_creating (store_not_billable
 * barra qualquer outro caso), não desta guarda de rota.
 */
export async function createBillingChargeAction(_prev: BillingChargeState, formData: FormData): Promise<BillingChargeState> {
  const parsed = billingChargeSchema.safeParse({
    payerEmail: String(formData.get("payerEmail") ?? ""),
    payerDocument: String(formData.get("payerDocument") ?? ""),
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
  const { store } = await requireStoreStatus(supabase, ["pending_payment", "suspended"], storeSlug);

  try {
    await createPlatformBillingCharge({
      storeId: store.id,
      payerEmail: parsed.data.payerEmail,
      payerDocType: document.type,
      payerDocNumber: document.digits,
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
