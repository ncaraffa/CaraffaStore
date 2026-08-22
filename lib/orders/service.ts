import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, FulfillmentMethod, OrderStatus } from "@/lib/supabase/types";

type Client = SupabaseClient<Database>;
type OrderRow = Database["public"]["Tables"]["orders"]["Row"];
type OrderItemRow = Database["public"]["Tables"]["order_items"]["Row"];

/**
 * Espelha o `code` de erro levantado pelas funções SQL de pedido (
 * `raise exception 'codigo' using errcode = ...`) — nunca inventado no
 * TypeScript, sempre vindo de `error.message` do RPC. Mesmo padrão de
 * lib/catalog/service.ts:CatalogError.
 */
export class OrderError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.name = "OrderError";
    this.code = code;
  }
}

function unwrap<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) {
    throw new OrderError(result.error.message);
  }
  if (result.data === null || result.data === undefined) {
    throw new OrderError("unexpected_empty_result");
  }
  return result.data;
}

/**
 * Endereço de entrega como o comprador preencheu. Cidade e UF são o que
 * decide a faixa de frete no banco — o CEP serve para localizar o
 * endereço e para o snapshot do pedido, não para calcular por faixa de
 * CEP (isso está fora do escopo da V1).
 */
/**
 * Endereço de entrega como o comprador preencheu — menos cidade e UF,
 * que decidem a faixa de frete e por isso são resolvidas no servidor a
 * partir do CEP. Aceitá-las daqui seria deixar o comprador escolher o
 * preço: bastaria mandar um CEP de São Paulo com a cidade da loja.
 */
export interface ShippingAddressInput {
  postalCode: string;
  street: string;
  number: string;
  complement?: string | null;
  neighborhood?: string | null;
}

// ============================================================
// Checkout público — criação (RPC: create_order, chamável por anon)
// ============================================================

export async function createOrder(
  supabase: Client,
  params: {
    storeSlug: string;
    idempotencyKey: string;
    customerName: string;
    customerPhone: string;
    fulfillmentMethod: FulfillmentMethod;
    deliveryAddress?: string;
    customerNotes?: string;
    items: { productId: string; quantity: number }[];
    /**
     * Código do cupom como o comprador digitou. Normalização, validação
     * e cálculo do desconto acontecem TODOS no banco, dentro da mesma
     * transação do pedido — daqui não sai nem desconto nem total.
     */
    couponCode?: string | null;
    /**
     * Endereço de entrega estruturado (TASK-013). Repare no que NÃO
     * existe aqui: valor de frete, e cidade/UF. A RPC não tem esses
     * parâmetros — o valor sai da configuração da loja e o destino de
     * shipping_resolve_destination sobre o CEP, então não há payload
     * capaz de alterar nem o preço nem a faixa.
     *
     * Só é exigido quando a loja tem entrega configurada; lojas sem
     * frete continuam usando `deliveryAddress` em texto livre.
     */
    shipping?: ShippingAddressInput | null;
    /**
     * Total que o comprador viu na tela. Trava opcional: se não bater
     * com o total recalculado no banco, o pedido é recusado
     * (`total_changed`) em vez de cobrar em silêncio um valor diferente
     * do exibido. Só aperta — nunca baixa o preço.
     */
    expectedTotalCents?: number | null;
  },
): Promise<OrderRow> {
  return unwrap(
    await supabase.rpc("create_order", {
      p_store_slug: params.storeSlug,
      p_idempotency_key: params.idempotencyKey,
      p_customer_name: params.customerName,
      p_customer_phone: params.customerPhone,
      p_fulfillment_method: params.fulfillmentMethod,
      p_delivery_address: params.deliveryAddress ?? null,
      p_customer_notes: params.customerNotes ?? null,
      p_items: params.items.map((item) => ({ product_id: item.productId, quantity: item.quantity })),
      p_coupon_code: params.couponCode ?? null,
      p_shipping_postal_code: params.shipping?.postalCode ?? null,
      p_shipping_street: params.shipping?.street ?? null,
      p_shipping_number: params.shipping?.number ?? null,
      p_shipping_complement: params.shipping?.complement ?? null,
      p_shipping_neighborhood: params.shipping?.neighborhood ?? null,
      p_expected_total_cents: params.expectedTotalCents ?? null,
    }),
  );
}

// ============================================================
// Painel — leitura (RLS: membro da loja, loja active)
// ============================================================

export async function listOrders(supabase: Client, storeId: string): Promise<OrderRow[]> {
  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .eq("store_id", storeId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function getOrderById(supabase: Client, orderId: string): Promise<OrderRow | null> {
  const { data, error } = await supabase.from("orders").select("*").eq("id", orderId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function listOrderItems(supabase: Client, orderId: string): Promise<OrderItemRow[]> {
  const { data, error } = await supabase
    .from("order_items")
    .select(
      "id, order_id, store_id, product_id, product_name_snapshot, product_slug_snapshot, unit_price_cents, quantity, line_total_cents, created_at",
    )
    .eq("order_id", orderId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

// ============================================================
// Painel — escrita (RPC, owner/admin apenas — checado no banco)
// ============================================================

export async function advanceOrderStatus(supabase: Client, orderId: string, newStatus: OrderStatus): Promise<OrderRow> {
  return unwrap(await supabase.rpc("order_advance_status", { p_order_id: orderId, p_new_status: newStatus }));
}

export async function cancelOrder(supabase: Client, orderId: string): Promise<OrderRow> {
  return unwrap(await supabase.rpc("order_cancel", { p_order_id: orderId }));
}
