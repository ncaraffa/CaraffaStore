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
/**
 * Código do cupom: aceito como texto livre e opcional. A normalização e
 * TODA a validação (existência, janela, mínimo, limite, entitlement do
 * plano) acontecem no banco — aqui só limitamos tamanho para não mandar
 * um payload absurdo.
 */
export const couponCodeSchema = z.string().trim().max(64).optional();

/**
 * TASK-013 — endereço estruturado. Os mesmos limites da RPC
 * create_order; validar aqui primeiro só evita uma viagem ao banco para
 * um erro óbvio, e a função SQL continua sendo a fonte de verdade.
 *
 * `shippingEnabled` NÃO é uma decisão do formulário: é o que a loja
 * respondeu na prévia (shipping_quote). Ele existe aqui só para o
 * superRefine saber QUAL endereço exigir. Se um payload mentir dizendo
 * que a loja não tem frete, o banco simplesmente calcula o frete assim
 * mesmo — e recusa o pedido por endereço ausente.
 */
export const postalCodeSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/\D/g, ""))
  .refine((value) => /^[0-9]{8}$/.test(value), "Informe um CEP válido, com 8 dígitos.");

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
    couponCode: couponCodeSchema,
    shippingEnabled: z.boolean().default(false),
    shippingPostalCode: z.string().trim().max(20).optional().or(z.literal("")),
    shippingStreet: z.string().trim().max(200, "Rua muito longa.").optional().or(z.literal("")),
    shippingNumber: z.string().trim().max(20, "Número muito longo.").optional().or(z.literal("")),
    shippingComplement: z.string().trim().max(100, "Complemento muito longo.").optional().or(z.literal("")),
    shippingNeighborhood: z.string().trim().max(120, "Bairro muito longo.").optional().or(z.literal("")),
    /**
     * Total exibido ao comprador. Vai para create_order como TRAVA: se
     * divergir do total recalculado no banco, o pedido é recusado. Não
     * há como usá-lo para pagar menos — só para o pedido falhar.
     */
    expectedTotalCents: z.coerce.number().int().min(0).max(100_000_000).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.fulfillmentMethod !== "delivery") {
      return;
    }

    // Loja sem frete configurado: caminho legado, endereço em texto livre.
    if (!data.shippingEnabled) {
      if (!data.deliveryAddress) {
        ctx.addIssue({ code: "custom", path: ["deliveryAddress"], message: "Informe o endereço de entrega." });
      }
      return;
    }

    // Loja com entrega configurada: CEP é obrigatório mesmo quando o
    // serviço de busca está fora do ar — é ele que identifica o destino
    // no pedido.
    if (!postalCodeSchema.safeParse(data.shippingPostalCode ?? "").success) {
      ctx.addIssue({ code: "custom", path: ["shippingPostalCode"], message: "Informe um CEP válido, com 8 dígitos." });
    }
    if (!data.shippingStreet) {
      ctx.addIssue({ code: "custom", path: ["shippingStreet"], message: "Informe a rua." });
    }
    if (!data.shippingNumber) {
      ctx.addIssue({ code: "custom", path: ["shippingNumber"], message: "Informe o número." });
    }
    // Cidade e UF não são validadas aqui porque não são mais enviadas: o
    // servidor as resolve do CEP. Quem recusa um CEP que ele não
    // conseguiu resolver é create_order (shipping_destination_unresolved).
  });
