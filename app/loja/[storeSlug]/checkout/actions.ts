"use server";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createOrder, OrderError } from "@/lib/orders/service";
import { checkoutSchema } from "@/lib/orders/schemas";
import { normalizePhone } from "@/lib/orders/phone";
import { messageForOrderError, FIELD_LEVEL_CODES } from "@/lib/orders/messages";
import { fieldErrorsFromZod } from "@/lib/auth/form-errors";

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
    fulfillmentMethod: String(formData.get("fulfillmentMethod") ?? ""),
    deliveryAddress: String(formData.get("deliveryAddress") ?? ""),
    customerNotes: String(formData.get("customerNotes") ?? ""),
    idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
    items: itemsRaw,
  });

  if (!normalizedPhone) {
    return { status: "error", fieldErrors: { customerPhone: "Informe um telefone válido." } };
  }
  if (!parsed.success) {
    return { status: "error", fieldErrors: fieldErrorsFromZod(parsed.error) };
  }

  const supabase = await createServerSupabaseClient();
  try {
    const order = await createOrder(supabase, {
      storeSlug,
      idempotencyKey: parsed.data.idempotencyKey,
      customerName: parsed.data.customerName,
      customerPhone: parsed.data.customerPhone,
      fulfillmentMethod: parsed.data.fulfillmentMethod,
      deliveryAddress: parsed.data.deliveryAddress || undefined,
      customerNotes: parsed.data.customerNotes || undefined,
      items: parsed.data.items.map((item) => ({ productId: item.productId, quantity: item.quantity })),
    });
    return { status: "success", publicCode: order.public_code, totalCents: order.total_cents };
  } catch (error) {
    const message = messageForOrderError(error);
    const fieldName = error instanceof OrderError ? FIELD_LEVEL_CODES[error.code] : undefined;
    return fieldName ? { status: "error", fieldErrors: { [fieldName]: message } } : { status: "error", message };
  }
}
