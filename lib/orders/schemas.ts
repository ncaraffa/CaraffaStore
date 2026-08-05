import { z } from "zod";

export const fulfillmentMethodSchema = z.enum(["pickup", "delivery"]);

export const cartItemSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.coerce.number().int().min(1, "Quantidade mínima é 1.").max(999, "Quantidade máxima é 999."),
});

/**
 * Mesmos limites da RPC create_order (supabase/migrations/0006_orders.sql)
 * — validar aqui primeiro só evita uma viagem ao banco para um erro
 * óbvio; a função SQL continua sendo a fonte de verdade (nunca confia em
 * nada vindo só desta camada).
 */
export const checkoutSchema = z
  .object({
    customerName: z.string().trim().min(2, "Informe seu nome.").max(120, "Nome muito longo."),
    customerPhone: z.string().trim().min(8, "Informe um telefone válido.").max(20, "Telefone inválido."),
    payerEmail: z.string().trim().email("Informe um e-mail válido.").max(200, "E-mail muito longo."),
    payerDocument: z.string().trim().min(11, "Informe um CPF ou CNPJ válido.").max(20, "Documento inválido."),
    fulfillmentMethod: fulfillmentMethodSchema,
    deliveryAddress: z.string().trim().max(500, "Endereço muito longo.").optional().or(z.literal("")),
    customerNotes: z.string().trim().max(1000, "Observações muito longas.").optional().or(z.literal("")),
    idempotencyKey: z.string().uuid(),
    items: z.array(cartItemSchema).min(1, "Seu carrinho está vazio.").max(50, "Carrinho com itens demais."),
  })
  .superRefine((data, ctx) => {
    if (data.fulfillmentMethod === "delivery" && !data.deliveryAddress) {
      ctx.addIssue({ code: "custom", path: ["deliveryAddress"], message: "Informe o endereço de entrega." });
    }
  });
