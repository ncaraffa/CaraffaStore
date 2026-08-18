"use server";

import { cookies } from "next/headers";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createPixCheckout, PixCheckoutError } from "@/lib/payments/checkout-orchestration";
import { checkoutSchema } from "@/lib/orders/schemas";
import { normalizePhone } from "@/lib/orders/phone";
import { parseDocument } from "@/lib/payments/document";
import { messageForOrderError, FIELD_LEVEL_CODES } from "@/lib/orders/messages";
import { fieldErrorsFromZod } from "@/lib/auth/form-errors";
import { RECEIPT_COOKIE_MAX_AGE_SECONDS, RECEIPT_COOKIE_NAME, receiptCookiePath } from "@/lib/payments/receipt-cookie";

export interface CheckoutState {
  status: "idle" | "error" | "success";
  message?: string;
  fieldErrors?: Record<string, string>;
  publicCode?: string;
  totalCents?: number;
}

export async function submitCheckoutAction(_prev: CheckoutState, formData: FormData): Promise<CheckoutState> {
  const storeSlug = String(formData.get("storeSlug") ?? "");
  const normalizedPhone = normalizePhone(String(formData.get("customerPhone") ?? ""));

  let itemsRaw: unknown;
  try {
    itemsRaw = JSON.parse(String(formData.get("items") ?? "[]"));
  } catch {
    return { status: "error", message: "Não foi possível ler o carrinho. Recarregue a página." };
  }

  const parsed = checkoutSchema.safeParse({
    customerName: String(formData.get("customerName") ?? ""),
    customerPhone: normalizedPhone ?? "",
    payerEmail: String(formData.get("payerEmail") ?? ""),
    payerDocument: String(formData.get("payerDocument") ?? ""),
    fulfillmentMethod: String(formData.get("fulfillmentMethod") ?? ""),
    deliveryAddress: String(formData.get("deliveryAddress") ?? ""),
    customerNotes: String(formData.get("customerNotes") ?? ""),
    idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
    items: itemsRaw,
    couponCode: String(formData.get("couponCode") ?? ""),
  });

  if (!normalizedPhone) {
    return { status: "error", fieldErrors: { customerPhone: "Informe um telefone válido." } };
  }
  if (!parsed.success) {
    return { status: "error", fieldErrors: fieldErrorsFromZod(parsed.error) };
  }

  const document = parseDocument(parsed.data.payerDocument);
  if (!document) {
    return { status: "error", fieldErrors: { payerDocument: "Informe um CPF ou CNPJ válido." } };
  }

  const supabase = await createServerSupabaseClient();
  try {
    const result = await createPixCheckout(supabase, {
      storeSlug,
      idempotencyKey: parsed.data.idempotencyKey,
      customerName: parsed.data.customerName,
      customerPhone: parsed.data.customerPhone,
      fulfillmentMethod: parsed.data.fulfillmentMethod,
      deliveryAddress: parsed.data.deliveryAddress || undefined,
      customerNotes: parsed.data.customerNotes || undefined,
      payerEmail: parsed.data.payerEmail,
      payerDocType: document.type,
      payerDocNumber: document.digits,
      items: parsed.data.items.map((item) => ({ productId: item.productId, quantity: item.quantity })),
      // O cupom vai como texto. O desconto NUNCA é enviado pelo cliente:
      // create_order revalida e recalcula tudo no banco, e a cobrança do
      // Mercado Pago usa o total resultante.
      couponCode: parsed.data.couponCode || null,
    });

    const cookieStore = await cookies();
    cookieStore.set(RECEIPT_COOKIE_NAME, result.receiptToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: receiptCookiePath(storeSlug, result.publicCode),
      maxAge: RECEIPT_COOKIE_MAX_AGE_SECONDS,
    });

    return { status: "success", publicCode: result.publicCode, totalCents: result.totalCents };
  } catch (error) {
    if (error instanceof PixCheckoutError) {
      const message = messageForOrderError(error);
      const fieldName = FIELD_LEVEL_CODES[error.code];
      return fieldName ? { status: "error", fieldErrors: { [fieldName]: message } } : { status: "error", message };
    }
    return { status: "error", message: "Não foi possível concluir. Tente novamente." };
  }
}
