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
  /**
   * Código de erro cru do backend, quando houver. A tela usa isto para
   * reagir — `total_changed`, por exemplo, dispara uma nova cotação, para
   * que a mensagem "confira o novo total" não aponte para um número
   * velho ainda na tela.
   */
  code?: string;
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
    // TASK-013 — a loja oferece entrega calculada? Vem do formulário só
    // para o schema saber QUAL endereço exigir. Mentir aqui não rende
    // nada: o banco decide o frete pela configuração real da loja e
    // recusa o pedido se o endereço necessário não vier.
    shippingEnabled: String(formData.get("shippingEnabled") ?? "") === "true",
    shippingPostalCode: String(formData.get("shippingPostalCode") ?? ""),
    shippingStreet: String(formData.get("shippingStreet") ?? ""),
    shippingNumber: String(formData.get("shippingNumber") ?? ""),
    shippingComplement: String(formData.get("shippingComplement") ?? ""),
    shippingNeighborhood: String(formData.get("shippingNeighborhood") ?? ""),
    // Cidade e UF NÃO viajam: o servidor as resolve pelo CEP. O que vem
    // aqui é o total que estava na tela, usado só como trava contra
    // divergência silenciosa — nunca como preço.
    expectedTotalCents: formData.get("expectedTotalCents") || undefined,
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
      // Idem para o frete: só o ENDEREÇO viaja — e nem ele inteiro.
      // Cidade e UF ficam de fora porque decidem a FAIXA; quem as
      // resolve é o banco, pelo CEP. O valor sai da configuração da
      // loja. Não existe campo de preço de frete em nenhum ponto deste
      // caminho.
      shipping:
        parsed.data.fulfillmentMethod === "delivery" && parsed.data.shippingEnabled
          ? {
              postalCode: parsed.data.shippingPostalCode ?? "",
              street: parsed.data.shippingStreet ?? "",
              number: parsed.data.shippingNumber ?? "",
              complement: parsed.data.shippingComplement || null,
              neighborhood: parsed.data.shippingNeighborhood || null,
            }
          : null,
      // Trava contra divergência silenciosa. Se o lojista mudou o frete
      // entre a tela e o envio, o pedido é recusado e o checkout mostra
      // o valor novo — em vez de debitar algo que o comprador não viu.
      expectedTotalCents: parsed.data.expectedTotalCents ?? null,
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
      return fieldName
        ? { status: "error", code: error.code, fieldErrors: { [fieldName]: message } }
        : { status: "error", code: error.code, message };
    }
    return { status: "error", message: "Não foi possível concluir. Tente novamente." };
  }
}
