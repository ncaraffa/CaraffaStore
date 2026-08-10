/**
 * Regressão real (Supabase local, sem mock) para TASK008-RETEST-ORD-001
 * (qa/reports/TASK-008-PROPAGATION-RETEST.md): o detalhe de pedido
 * (app/dashboard/orders/[orderId]/page.tsx) chamava getOrderPayment/
 * listPaymentEvents incondicionalmente para pedidos Pix, mas
 * payment_events_list_sanitized (0007_payments.sql) só autoriza
 * owner/admin — staff sempre recebia insufficient_privilege/42501 e a
 * página quebrava. Mesma classe de falha do dashboard home
 * (TASK008-PROP-001), agora no detalhe.
 *
 * Cria um pedido Pix REAL (create_order → pix_payment_attempt_upsert_creating
 * → pix_payment_mark_created, mesmas RPCs de produção, mesmo padrão de
 * supabase/tests/payment-concurrency-check.ts) e chama as MESMAS funções
 * de lib/ que a página usa, autenticado como staff e como owner/admin,
 * documentando o contrato do qual a correção (role gating em
 * app/dashboard/orders/[orderId]/page.tsx) depende:
 *   - getOrderPayment (SELECT direto, RLS) devolve null para staff —
 *     silenciosamente filtrado, sem lançar;
 *   - listPaymentEvents (RPC) lança insufficient_privilege para staff;
 *   - ambos funcionam normalmente para owner/admin.
 *
 * Como rodar:
 *   npx supabase start && npx supabase db reset && npm run seed:local
 *   npx tsx supabase/tests/order-detail-payment-access-check.ts
 */
import { createClient } from "@supabase/supabase-js";
import { createHash, randomUUID } from "node:crypto";
import { loadLocalEnv } from "../../lib/env/load-local-env";
import { createAdminSupabaseClient } from "../../lib/supabase/admin";
import { getPublicSupabaseEnv } from "../../lib/supabase/env";
import { getOrderPayment, listPaymentEvents } from "../../lib/payments/order-payments-service";
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

async function createPublishedProduct(storeId: string, namePrefix: string): Promise<string> {
  const adminA = await signIn("admin-a@example.test");
  // products ainda carrega a constraint original unique(store_id, name) de
  // 0001_init.sql (nunca removida quando 0005_catalog.sql adicionou
  // slug/sku) — nome precisa ser único por execução, não só o slug.
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const name = `${namePrefix} ${unique}`;
  const slug = `${namePrefix.toLowerCase().replace(/\s+/g, "-")}-${unique}`;
  const { data, error } = await adminA.rpc("catalog_create_product", {
    p_store_id: storeId,
    p_name: name,
    p_slug: slug,
    p_price_cents: 3290,
    p_stock: 10,
  });
  if (error || !data) throw new Error(`criação de produto falhou: ${error?.message}`);
  const product = data as { id: string };
  const { error: pubError } = await adminA.rpc("catalog_set_product_status", { p_product_id: product.id, p_status: "published" });
  if (pubError) throw new Error(`publicação de produto falhou: ${pubError.message}`);
  return product.id;
}

async function createPixOrder(storeSlug: string, productId: string): Promise<string> {
  const { data: order, error: orderError } = await anonClient().rpc("create_order", {
    p_store_slug: storeSlug,
    p_idempotency_key: randomUUID(),
    p_customer_name: "Cliente QA ORD-001",
    p_customer_phone: "+5511999990099",
    p_fulfillment_method: "pickup",
    p_delivery_address: null,
    p_customer_notes: null,
    p_items: [{ product_id: productId, quantity: 1 }],
  });
  if (orderError || !order) throw new Error(`create_order falhou: ${orderError?.message}`);
  const orderRow = order as { id: string; total_cents: number };

  const admin = createAdminSupabaseClient();
  const receiptHash = createHash("sha256").update(`receipt-ord001-${orderRow.id}`).digest("hex");
  const { data: attempt, error: attemptError } = await admin.rpc("pix_payment_attempt_upsert_creating", {
    p_order_id: orderRow.id,
    p_provider_idempotency_key: `pix-ord001-${orderRow.id.replace(/-/g, "")}`,
    p_amount_cents: orderRow.total_cents,
    p_currency: "BRL",
    p_payer_email: "cliente@example.test",
    p_payer_doc_type: "CPF",
    p_payer_doc_last4: "5678",
    p_receipt_token_hash: receiptHash,
  });
  if (attemptError || !attempt) throw new Error(`pix_payment_attempt_upsert_creating falhou: ${attemptError?.message}`);
  const attemptRow = attempt as { id: string };

  const { error: markError } = await admin.rpc("pix_payment_mark_created", {
    p_payment_attempt_id: attemptRow.id,
    p_provider_payment_id: `fake-ord001-${attemptRow.id.slice(0, 8)}`,
    p_provider_status: "pending",
    p_provider_status_detail: "pending_waiting_transfer",
    p_qr_code: "qr-fake-ord001",
    p_qr_code_base64: "base64-fake-ord001",
    p_ticket_url: "https://ticket.fake/ord001",
    p_expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
  });
  if (markError) throw new Error(`pix_payment_mark_created falhou: ${markError.message}`);

  return orderRow.id;
}

async function main() {
  loadLocalEnv();
  const admin = createAdminSupabaseClient();

  const { data: storeA, error: storeAError } = await admin.from("stores").select("id,slug").eq("slug", "store-a").single();
  if (storeAError || !storeA) throw new Error("store-a não encontrada — rode npm run seed:local");

  console.log("Criando produto e pedido Pix real via RPCs de produção...");
  const productId = await createPublishedProduct(storeA.id, "Produto QA ORD-001");
  const orderId = await createPixOrder(storeA.slug, productId);
  console.log(`Pedido Pix criado: ${orderId}`);

  const staff = await signIn("merchant-multi@example.test");
  const staffPayment = await getOrderPayment(staff, orderId);
  record(
    "staff (merchant-multi): getOrderPayment devolve null (RLS filtra, não lança)",
    staffPayment === null,
    `resultado=${staffPayment === null ? "null" : "objeto"}`,
  );

  let staffEventsBlocked = false;
  let staffEventsErrorMessage = "";
  try {
    await listPaymentEvents(staff, orderId);
  } catch (error) {
    staffEventsBlocked = true;
    staffEventsErrorMessage =
      error instanceof Error
        ? error.message
        : typeof error === "object" && error !== null && "message" in error
          ? String((error as { message: unknown }).message)
          : String(error);
  }
  record(
    "staff (merchant-multi): listPaymentEvents lança insufficient_privilege (mesma RPC que quebrava a página)",
    staffEventsBlocked && staffEventsErrorMessage.includes("insufficient_privilege"),
    `bloqueado=${staffEventsBlocked} mensagem=${staffEventsErrorMessage}`,
  );

  const ownerOrAdmin = await signIn("admin-a@example.test");
  const adminPayment = await getOrderPayment(ownerOrAdmin, orderId).catch((error) => {
    record("admin (admin-a): getOrderPayment funciona", false, `lançou: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  });
  if (adminPayment) {
    record("admin (admin-a): getOrderPayment funciona", true, `status=${adminPayment.status}`);
  }

  const adminEvents = await listPaymentEvents(ownerOrAdmin, orderId).catch((error) => {
    record("admin (admin-a): listPaymentEvents funciona sem lançar", false, `lançou: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  });
  if (adminEvents !== null) {
    record("admin (admin-a): listPaymentEvents funciona sem lançar", true, `eventos=${adminEvents.length}`);
  }

  const failed = results.filter((r) => !r.pass);
  if (failed.length > 0) {
    throw new Error(`${failed.length} verificação(ões) falharam — ver detalhes acima.`);
  }

  console.log(
    "\nPASS - detalhe de pedido Pix: staff nunca recebe insufficient_privilege da página (as leituras reservadas simplesmente não são tentadas); owner/admin continuam lendo pagamento/eventos normalmente.",
  );
}

main().catch((error) => {
  console.error(`Teste de acesso ao detalhe de pedido falhou: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
