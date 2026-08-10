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
 *
 * Cada métrica é calculada com sua PRÓPRIA query, sem um `limit()` global
 * que corte pedidos antigos (qa/reports/TASK-008-PROPAGATION-REVIEW.md,
 * TASK008-PROP-003 — o antigo `RECENT_ORDERS_LIMIT = 300` subestimava
 * receita/contagens em lojas de maior volume, sem aviso):
 *
 * - contagens (`ordersLast24h`, `pendingPixCount`) usam
 *   `count: "exact", head: true` — o Postgres conta no banco e o
 *   PostgREST devolve só o total no header, sem trafegar linha nenhuma,
 *   então o custo não cresce com o volume de pedidos exibidos.
 * - `revenueLast30dCents` filtra `status`/`created_at` já na query (só
 *   os pedidos elegíveis da janela chegam ao servidor) e pagina em
 *   blocos de 1000 via `.range()` só como proteção para janelas de alto
 *   volume — não é um corte, soma todas as páginas até esgotar.
 * - `recentOrders` (exibição) busca só os 5 mais recentes, que é tudo
 *   que a UI usa; `hasAnyOrder` deriva desse mesmo resultado (se existe
 *   qualquer pedido, ele aparece entre os 5 mais recentes).
 *
 * Agregação de SUM diretamente no Postgres via REST (`select=total_cents.sum()`)
 * foi avaliada e descartada nesta rodada: o PostgREST local recusa com
 * `PGRST123 — Use of aggregate functions is not allowed` porque
 * `db-aggregates-enabled` está desligado por padrão; ligar esse flag é
 * uma mudança de configuração de API (não só de código) que valeria por
 * si só, e habilitaria agregações para outras tabelas além de `orders` —
 * fora do escopo desta correção pontual.
 */
const REVENUE_STATUSES: OrderStatus[] = ["confirmed", "preparing", "ready", "completed"];
const LOW_STOCK_THRESHOLD = 5;
const RECENT_ORDERS_DISPLAY_LIMIT = 5;
const REVENUE_PAGE_SIZE = 1000;

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
  recentOrders: DashboardOrderSummary[];
  productsPublished: number;
  productsDraft: number;
  productsTotal: number;
  lowStockProducts: { id: string; name: string; stock: number }[];
}

async function sumRevenueLast30d(supabase: Client, storeId: string, sinceIso: string): Promise<number> {
  let total = 0;
  let from = 0;

  for (;;) {
    const { data, error } = await supabase
      .from("orders")
      .select("total_cents")
      .eq("store_id", storeId)
      .in("status", REVENUE_STATUSES)
      .gte("created_at", sinceIso)
      // TASK008-RETEST-DATA-001: .range() sem ORDER BY estável não
      // garante a mesma ordem entre páginas — sob escrita concorrente,
      // OFFSET pode pular ou repetir linha. `created_at` sozinho pode
      // empatar (mesmo timestamp), então `id` desempata e torna a
      // ordenação verdadeiramente determinística.
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + REVENUE_PAGE_SIZE - 1);

    if (error) throw error;

    const page = data ?? [];
    for (const row of page) total += row.total_cents;

    if (page.length < REVENUE_PAGE_SIZE) break;
    from += REVENUE_PAGE_SIZE;
  }

  return total;
}

export async function getDashboardSummary(supabase: Client, storeId: string): Promise<DashboardSummary> {
  const now = Date.now();
  const dayAgoIso = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const thirtyDaysAgoIso = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [ordersLast24hResult, pendingPixResult, revenueLast30dCents, recentOrdersResult, productsResult] =
    await Promise.all([
      supabase
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("store_id", storeId)
        .gte("created_at", dayAgoIso),
      supabase
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("store_id", storeId)
        .eq("status", "pending")
        .eq("payment_mode", "pix"),
      sumRevenueLast30d(supabase, storeId, thirtyDaysAgoIso),
      supabase
        .from("orders")
        .select("id, public_code, customer_name, total_cents, status, created_at")
        .eq("store_id", storeId)
        .order("created_at", { ascending: false })
        .limit(RECENT_ORDERS_DISPLAY_LIMIT),
      supabase.from("products").select("id, name, stock, status").eq("store_id", storeId),
    ]);

  if (ordersLast24hResult.error) throw ordersLast24hResult.error;
  if (pendingPixResult.error) throw pendingPixResult.error;
  if (recentOrdersResult.error) throw recentOrdersResult.error;
  if (productsResult.error) throw productsResult.error;

  const recentOrdersRaw = recentOrdersResult.data ?? [];
  const products = productsResult.data ?? [];

  const recentOrders: DashboardOrderSummary[] = recentOrdersRaw.map((order) => ({
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
    hasAnyOrder: recentOrders.length > 0,
    ordersLast24h: ordersLast24hResult.count ?? 0,
    revenueLast30dCents,
    pendingPixCount: pendingPixResult.count ?? 0,
    recentOrders,
    productsPublished,
    productsDraft,
    productsTotal: products.length,
    lowStockProducts,
  };
}
