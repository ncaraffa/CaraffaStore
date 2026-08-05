/**
 * Teste real de concorrência para create_order/order_cancel (TASK-004):
 * conexões HTTP reais e independentes via supabase-js (não SAVEPOINTs de
 * uma única sessão psql, que são sequenciais por natureza — mesmo motivo
 * de supabase/tests/stock-concurrency-check.ts para a TASK-003).
 *
 * Cobre:
 *   - overselling: 2 pedidos concorrentes de quantidade 4 sobre estoque 5
 *     -> exatamente 1 sucede, estoque final 1.
 *   - carrinho multi-produto em ordem invertida entre duas requisições
 *     concorrentes não trava em deadlock (bloqueio determinístico por
 *     ORDER BY id em create_order).
 *   - idempotência sob concorrência real: 2 chamadas SIMULTÂNEAS com a
 *     MESMA idempotency_key nunca criam 2 pedidos nem baixam estoque 2x.
 *   - cancelamento concorrente: 2 chamadas simultâneas de order_cancel no
 *     MESMO pedido -> exatamente uma bem-sucedida, estoque devolvido uma
 *     única vez.
 *
 * Como rodar:
 *   npx supabase start && npx supabase db reset && npm run seed:local
 *   npx tsx supabase/tests/order-concurrency-check.ts
 */
import { createClient } from "@supabase/supabase-js";
import { loadLocalEnv } from "../../lib/env/load-local-env";
import { createAdminSupabaseClient } from "../../lib/supabase/admin";
import { getPublicSupabaseEnv } from "../../lib/supabase/env";
import type { Database } from "../../lib/supabase/types";

const DEV_ONLY_PASSWORD = "dev-local-only-not-a-real-secret-123!";

const results: { label: string; pass: boolean; detail: string }[] = [];
function record(label: string, pass: boolean, detail: string) {
  results.push({ label, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} - ${label}: ${detail}`);
}

function anonClient() {
  const env = getPublicSupabaseEnv();
  return createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

async function signIn(email: string) {
  const client = anonClient();
  const { error } = await client.auth.signInWithPassword({ email, password: DEV_ONLY_PASSWORD });
  if (error) throw new Error(`login falhou para ${email}: ${error.message}`);
  return client;
}

async function createPublishedProduct(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  adminClient: Awaited<ReturnType<typeof signIn>>,
  storeId: string,
  name: string,
  stock: number,
) {
  const { data, error } = await adminClient.rpc("catalog_create_product", {
    p_store_id: storeId,
    p_name: name,
    p_slug: name.toLowerCase().replace(/\s+/g, "-") + "-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6),
    p_price_cents: 500,
    p_stock: stock,
  });
  if (error || !data) throw new Error(`criação de produto (${name}) falhou: ${error?.message}`);
  const product = data as { id: string };
  const { error: pubError } = await adminClient.rpc("catalog_set_product_status", {
    p_product_id: product.id,
    p_status: "published",
  });
  if (pubError) throw new Error(`publicação de produto (${name}) falhou: ${pubError.message}`);
  return product.id;
}

async function overselling(admin: ReturnType<typeof createAdminSupabaseClient>) {
  const { data: storeA } = await admin.from("stores").select("id,slug").eq("slug", "store-a").single();
  if (!storeA) throw new Error("store-a não encontrada — rode npm run seed:local");
  const adminA = await signIn("admin-a@example.test");

  const productId = await createPublishedProduct(admin, adminA, storeA.id, "Concorrencia Overselling", 5);

  console.log("Disparando 2 pedidos concorrentes de quantidade 4 sobre estoque 5...");
  const clients = [anonClient(), anonClient()];
  const outcomes = await Promise.all(
    clients.map((c) =>
      c.rpc("create_order", {
        p_store_slug: storeA.slug,
        p_idempotency_key: crypto.randomUUID(),
        p_customer_name: "Cliente Concorrente",
        p_customer_phone: "+5511999990000",
        p_fulfillment_method: "pickup",
        p_delivery_address: null,
        p_customer_notes: null,
        p_items: [{ product_id: productId, quantity: 4 }],
      }),
    ),
  );
  const successes = outcomes.filter((o) => !o.error);
  const failures = outcomes.filter((o) => o.error);

  record(
    "2 pedidos concorrentes de qty=4 sobre estoque=5: exatamente 1 sucede",
    successes.length === 1,
    `sucessos=${successes.length}`,
  );
  record(
    "a falha restante é insufficient_stock (nunca outro erro)",
    failures.length === 1 && failures[0]?.error?.message === "insufficient_stock",
    `erro=${failures[0]?.error?.message}`,
  );

  const { data: finalProduct } = await admin.from("products").select("stock").eq("id", productId).single();
  record("estoque final é exatamente 1 (nunca negativo)", finalProduct?.stock === 1, `stock=${finalProduct?.stock}`);

  const { data: orderRows } = await admin.from("orders").select("id").eq("total_cents", 2000);
  record(
    "exatamente 1 pedido persistido (o outro nunca foi criado)",
    (orderRows ?? []).filter((o) => successes.some((s) => (s.data as { id: string } | null)?.id === o.id)).length === 1,
    `pedidos_no_banco_com_esse_total=${(orderRows ?? []).length}`,
  );
}

async function multiProductReversedOrderNoDeadlock(admin: ReturnType<typeof createAdminSupabaseClient>) {
  const { data: storeA } = await admin.from("stores").select("id,slug").eq("slug", "store-a").single();
  if (!storeA) throw new Error("store-a não encontrada");
  const adminA = await signIn("admin-a@example.test");

  const productX = await createPublishedProduct(admin, adminA, storeA.id, "Concorrencia X", 10);
  const productY = await createPublishedProduct(admin, adminA, storeA.id, "Concorrencia Y", 10);

  console.log("Disparando 2 pedidos concorrentes com os MESMOS 2 produtos em ordem invertida (teste de deadlock)...");
  const [clientOne, clientTwo] = [anonClient(), anonClient()];
  const start = Date.now();
  const outcomes = await Promise.all([
    clientOne.rpc("create_order", {
      p_store_slug: storeA.slug,
      p_idempotency_key: crypto.randomUUID(),
      p_customer_name: "Cliente Ordem 1",
      p_customer_phone: "+5511999990001",
      p_fulfillment_method: "pickup",
      p_delivery_address: null,
      p_customer_notes: null,
      p_items: [
        { product_id: productX, quantity: 1 },
        { product_id: productY, quantity: 1 },
      ],
    }),
    clientTwo.rpc("create_order", {
      p_store_slug: storeA.slug,
      p_idempotency_key: crypto.randomUUID(),
      p_customer_name: "Cliente Ordem 2",
      p_customer_phone: "+5511999990002",
      p_fulfillment_method: "pickup",
      p_delivery_address: null,
      p_customer_notes: null,
      // ordem INVERTIDA no carrinho do segundo cliente
      p_items: [
        { product_id: productY, quantity: 1 },
        { product_id: productX, quantity: 1 },
      ],
    }),
  ]);
  const elapsedMs = Date.now() - start;
  const successes = outcomes.filter((o) => !o.error);

  record(
    "2 pedidos com produtos em comum, ordem invertida no carrinho: ambos concluem sem deadlock",
    successes.length === 2 && elapsedMs < 10_000,
    `sucessos=${successes.length}/2, tempo=${elapsedMs}ms, erros=${JSON.stringify(outcomes.map((o) => o.error?.message))}`,
  );

  const { data: stockX } = await admin.from("products").select("stock").eq("id", productX).single();
  const { data: stockY } = await admin.from("products").select("stock").eq("id", productY).single();
  record(
    "estoque de ambos os produtos reduzido corretamente (10 -> 8 cada)",
    stockX?.stock === 8 && stockY?.stock === 8,
    `stockX=${stockX?.stock} stockY=${stockY?.stock}`,
  );
}

async function idempotencyUnderRealConcurrency(admin: ReturnType<typeof createAdminSupabaseClient>) {
  const { data: storeA } = await admin.from("stores").select("id,slug").eq("slug", "store-a").single();
  if (!storeA) throw new Error("store-a não encontrada");
  const adminA = await signIn("admin-a@example.test");

  const productId = await createPublishedProduct(admin, adminA, storeA.id, "Concorrencia Idempotencia", 10);
  const idempotencyKey = crypto.randomUUID();

  console.log("Disparando 2 chamadas SIMULTÂNEAS com a MESMA idempotency_key...");
  const clients = [anonClient(), anonClient()];
  const outcomes = await Promise.all(
    clients.map((c) =>
      c.rpc("create_order", {
        p_store_slug: storeA.slug,
        p_idempotency_key: idempotencyKey,
        p_customer_name: "Cliente Duplo Clique",
        p_customer_phone: "+5511999990003",
        p_fulfillment_method: "pickup",
        p_delivery_address: null,
        p_customer_notes: null,
        p_items: [{ product_id: productId, quantity: 3 }],
      }),
    ),
  );
  const errors = outcomes.filter((o) => o.error);
  const ids = new Set(outcomes.map((o) => (o.data as { id: string } | null)?.id).filter(Boolean));

  record(
    "2 chamadas simultâneas com a mesma idempotency_key: nenhuma falha, mesmo pedido retornado",
    errors.length === 0 && ids.size === 1,
    `erros=${errors.length} ids_distintos=${ids.size}`,
  );

  const { data: finalProduct } = await admin.from("products").select("stock").eq("id", productId).single();
  record(
    "estoque baixado exatamente uma vez sob concorrência real (10 -> 7, não 4)",
    finalProduct?.stock === 7,
    `stock=${finalProduct?.stock}`,
  );
}

async function concurrentCancel(admin: ReturnType<typeof createAdminSupabaseClient>) {
  const { data: storeA } = await admin.from("stores").select("id,slug").eq("slug", "store-a").single();
  if (!storeA) throw new Error("store-a não encontrada");
  const adminA = await signIn("admin-a@example.test");

  const productId = await createPublishedProduct(admin, adminA, storeA.id, "Concorrencia Cancelamento", 10);

  const { data: order, error: createError } = await anonClient().rpc("create_order", {
    p_store_slug: storeA.slug,
    p_idempotency_key: crypto.randomUUID(),
    p_customer_name: "Cliente Cancelamento",
    p_customer_phone: "+5511999990004",
    p_fulfillment_method: "pickup",
    p_delivery_address: null,
    p_customer_notes: null,
    p_items: [{ product_id: productId, quantity: 5 }],
  });
  if (createError || !order) throw new Error(`criação do pedido para teste de cancelamento falhou: ${createError?.message}`);
  const orderId = (order as { id: string }).id;

  console.log("Disparando 2 cancelamentos SIMULTÂNEOS do mesmo pedido...");
  const cancelClients = [await signIn("admin-a@example.test"), await signIn("admin-a@example.test")];
  const outcomes = await Promise.all(cancelClients.map((c) => c.rpc("order_cancel", { p_order_id: orderId })));
  const successes = outcomes.filter((o) => !o.error);
  const failures = outcomes.filter((o) => o.error);

  record(
    "2 cancelamentos concorrentes do mesmo pedido: exatamente 1 bem-sucedido",
    successes.length === 1,
    `sucessos=${successes.length}`,
  );
  record(
    "a falha restante é invalid_status_transition (já cancelado)",
    failures.length === 1 && failures[0]?.error?.message === "invalid_status_transition",
    `erro=${failures[0]?.error?.message}`,
  );

  const { data: finalProduct } = await admin.from("products").select("stock").eq("id", productId).single();
  record("estoque devolvido exatamente uma vez (5 -> 10, não 15)", finalProduct?.stock === 10, `stock=${finalProduct?.stock}`);

  const { data: auditRows } = await admin.from("audit_log").select("action").eq("target_id", orderId);
  const cancelledCount = (auditRows ?? []).filter((r) => r.action === "order_cancelled").length;
  record("exatamente 1 evento order_cancelled (sem duplicar)", cancelledCount === 1, `eventos=${cancelledCount}`);
}

async function main() {
  loadLocalEnv();
  const admin = createAdminSupabaseClient();

  await overselling(admin);
  await multiProductReversedOrderNoDeadlock(admin);
  await idempotencyUnderRealConcurrency(admin);
  await concurrentCancel(admin);

  const failed = results.filter((r) => !r.pass);
  if (failed.length > 0) {
    throw new Error(`${failed.length} verificação(ões) falharam — ver detalhes acima.`);
  }

  console.log(
    "\nPASS - pedidos nunca causam overselling sob concorrência real; carrinhos com produtos em comum em ordem invertida não causam deadlock; idempotência e cancelamento seguros sob concorrência real.",
  );
}

main().catch((error) => {
  console.error(`Teste de concorrência de pedidos falhou: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
