import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireStoreStatus } from "@/lib/tenant/access-control";
import { DashboardNav } from "@/app/dashboard/dashboard-nav";
import * as orders from "@/lib/orders/service";
import { formatPriceCents } from "@/lib/catalog/format";
import type { OrderStatus } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<OrderStatus, string> = {
  pending: "Pendente",
  confirmed: "Confirmado",
  preparing: "Em preparo",
  ready: "Pronto",
  completed: "Concluído",
  cancelled: "Cancelado",
};

const STATUS_TONE: Record<OrderStatus, "neutral" | "success" | "warning"> = {
  pending: "warning",
  confirmed: "neutral",
  preparing: "neutral",
  ready: "neutral",
  completed: "success",
  cancelled: "neutral",
};

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ store?: string }> }) {
  const { store: storeSlug } = await searchParams;
  const supabase = await createServerSupabaseClient();
  const { store } = await requireStoreStatus(supabase, "active", storeSlug);

  const list = await orders.listOrders(supabase, store.id);

  return (
    <main>
      <h1>Pedidos — {store.name}</h1>
      <DashboardNav storeSlug={store.slug} />

      {list.length === 0 ? (
        <p>Nenhum pedido ainda.</p>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Código</th>
                <th>Cliente</th>
                <th>Telefone</th>
                <th>Data</th>
                <th>Modalidade</th>
                <th>Total</th>
                <th>Status</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {list.map((order) => (
                <tr key={order.id}>
                  <td>{order.public_code}</td>
                  <td>{order.customer_name}</td>
                  <td>{order.customer_phone}</td>
                  <td>{new Date(order.created_at).toLocaleString("pt-BR")}</td>
                  <td>{order.fulfillment_method === "pickup" ? "Retirada" : "Entrega"}</td>
                  <td>{formatPriceCents(order.total_cents)}</td>
                  <td>
                    <span className="badge" data-tone={STATUS_TONE[order.status]}>
                      {STATUS_LABEL[order.status]}
                    </span>
                  </td>
                  <td>
                    <a href={`/dashboard/orders/${order.id}?store=${store.slug}`}>Abrir</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
