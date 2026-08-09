import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, OrderStatus } from "@/lib/supabase/types";

type Client = SupabaseClient<Database>;

/**
 * Agregações do painel inicial — tudo derivado de `orders` e `products`
 * já lidos hoje por lib/orders/service.ts e lib/catalog/service.ts, sob
 * as MESMAS políticas de RLS (membro autenticado da própria loja). Nada
 * aqui é uma tabela, RPC ou permissão nova — é leitura pura, agregada em
 * memória, exatamente como o restante do painel já faz.
 *
 * `status IN ('confirmed','preparing','ready','completed')` é o corte
 * correto para "receita confirmada": para payment_mode='pix', a função
 * SQL pix_payment_apply_provider_state é a ÚNICA coisa que move um
 * pedido de pending para confirmed (supabase/migrations/0007_payments.sql,
 * comentário de order_advance_status) — ou seja, esse status só existe
 * depois que o Pix foi de fato aprovado pelo Mercado Pago. Para
 * payment_mode='manual' significa confirmação administrativa. Em nenhum
 * caso é uma métrica inventada.
 */
const REVENUE_STATUSES: OrderStatus[] = ["confirmed", "preparing", "ready", "completed"];
const RECENT_ORDERS_LIMIT = 300;
const LOW_STOCK_THRESHOLD = 5;

export interface DashboardOrderSummary {
  id: string;
  publicCode: string;
  customerName: string;
  totalCents: number;
  status: OrderStatus;
  createdAt: string;
}

export interface DashboardSummary {
  hasAnyOrder: boolean;
  ordersLast24h: number;
  revenueLast30dCents: number;
  pendingPixCount: number;
  statusCounts: Record<OrderStatus, number>;
  recentOrders: DashboardOrderSummary[];
  productsPublished: number;
  productsDraft: number;
  productsTotal: number;
  lowStockProducts: { id: string; name: string; stock: number }[];
}

export async function getDashboardSummary(supabase: Client, storeId: string): Promise<DashboardSummary> {
  const [ordersResult, productsResult] = await Promise.all([
    supabase
      .from("orders")
      .select("id, public_code, customer_name, total_cents, status, payment_mode, created_at")
      .eq("store_id", storeId)
      .order("created_at", { ascending: false })
      .limit(RECENT_ORDERS_LIMIT),
    supabase.from("products").select("id, name, stock, status").eq("store_id", storeId),
  ]);

  if (ordersResult.error) throw ordersResult.error;
  if (productsResult.error) throw productsResult.error;

  const orders = ordersResult.data ?? [];
  const products = productsResult.data ?? [];

  const now = Date.now();
  const dayAgo = now - 24 * 60 * 60 * 1000;
  const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

  const statusCounts: Record<OrderStatus, number> = {
    pending: 0,
    confirmed: 0,
    preparing: 0,
    ready: 0,
    completed: 0,
    cancelled: 0,
  };

  let ordersLast24h = 0;
  let revenueLast30dCents = 0;
  let pendingPixCount = 0;

  for (const order of orders) {
    statusCounts[order.status] += 1;

    const createdAtMs = new Date(order.created_at).getTime();
    if (createdAtMs >= dayAgo) ordersLast24h += 1;

    if (REVENUE_STATUSES.includes(order.status) && createdAtMs >= thirtyDaysAgo) {
      revenueLast30dCents += order.total_cents;
    }

    if (order.status === "pending" && order.payment_mode === "pix") {
      pendingPixCount += 1;
    }
  }

  const recentOrders: DashboardOrderSummary[] = orders.slice(0, 5).map((order) => ({
    id: order.id,
    publicCode: order.public_code,
    customerName: order.customer_name,
    totalCents: order.total_cents,
    status: order.status,
    createdAt: order.created_at,
  }));

  const productsPublished = products.filter((p) => p.status === "published").length;
  const productsDraft = products.filter((p) => p.status === "draft").length;

  const lowStockProducts = products
    .filter((p) => p.status === "published" && p.stock <= LOW_STOCK_THRESHOLD)
    .sort((a, b) => a.stock - b.stock)
    .slice(0, 4)
    .map((p) => ({ id: p.id, name: p.name, stock: p.stock }));

  return {
    hasAnyOrder: orders.length > 0,
    ordersLast24h,
    revenueLast30dCents,
    pendingPixCount,
    statusCounts,
    recentOrders,
    productsPublished,
    productsDraft,
    productsTotal: products.length,
    lowStockProducts,
  };
}
