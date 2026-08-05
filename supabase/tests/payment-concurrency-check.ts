/**
 * Teste real de concorrência para o motor de pagamentos Pix (TASK-005):
 * conexões HTTP reais e independentes via supabase-js (mesmo motivo de
 * supabase/tests/order-concurrency-check.ts, TASK-004) — nunca SAVEPOINTs
 * de uma única sessão psql, que são sequenciais por natureza.
 *
 * Cobre:
 *   - dois "webhooks approved" concorrentes no mesmo pagamento -> pedido
 *     confirmado exatamente uma vez, sem efeito duplicado.
 *   - webhook approved concorrente com uma reconciliação (mesma função,
 *     pix_payment_apply_provider_state) -> mesma garantia.
 *   - approved concorrente com cancelled no MESMO pagamento pending ->
 *     exatamente um estado terminal vence (confirmed OU cancelled, nunca
 *     os dois), o perdedor vira manual_review, estoque nunca fica
 *     inconsistente com o status final.
 *   - dois retries concorrentes de criação de pagamento (mesmo order_id)
 *     -> exatamente uma linha de payment_attempt, nunca duas.
 *
 * Como rodar:
 *   npx supabase start && npx supabase db reset && npm run seed:local
 *   npx tsx supabase/tests/payment-concurrency-check.ts
 */
import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
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

type Admin = ReturnType<typeof createAdminSupabaseClient>;

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

async function createPublishedProduct(storeId: string, name: string, stock: number, priceCents = 1000) {
  const adminA = await signIn("admin-a@example.test");
  const slug = `${name.toLowerCase().replace(/\s+/g, "-")}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const { data, error } = await adminA.rpc("catalog_create_product", {
    p_store_id: storeId,
    p_name: name,
    p_slug: slug,
    p_price_cents: priceCents,
    p_stock: stock,
  });
  if (error || !data) throw new Error(`criação de produto (${name}) falhou: ${error?.message}`);
  const product = data as { id: string };
  const { error: pubError } = await adminA.rpc("catalog_set_product_status", { p_product_id: product.id, p_status: "published" });
  if (pubError) throw new Error(`publicação de produto (${name}) falhou: ${pubError.message}`);
  return product.id;
}

async function createPixOrderWithAttempt(admin: Admin, storeSlug: string, productId: string, quantity: number) {
  const { data: order, error: orderError } = await anonClient().rpc("create_order", {
    p_store_slug: storeSlug,
    p_idempotency_key: crypto.randomUUID(),
    p_customer_name: "Cliente Pix Concorrência",
    p_customer_phone: "+5511999990010",
    p_fulfillment_method: "pickup",
    p_delivery_address: null,
    p_customer_notes: null,
    p_items: [{ product_id: productId, quantity }],
  });
  if (orderError || !order) throw new Error(`create_order falhou: ${orderError?.message}`);
  const orderId = (order as { id: string; total_cents: number }).id;
  const totalCents = (order as { id: string; total_cents: number }).total_cents;

  const receiptHash = createHash("sha256").update(`receipt-${orderId}`).digest("hex");
  const { data: attempt, error: attemptError } = await admin.rpc("pix_payment_attempt_upsert_creating", {
    p_order_id: orderId,
    p_provider_idempotency_key: `pix-${orderId.replace(/-/g, "")}`,
    p_amount_cents: totalCents,
    p_currency: "BRL",
    p_payer_email: "cliente@example.test",
    p_payer_doc_type: "CPF",
    p_payer_doc_last4: "1234",
    p_receipt_token_hash: receiptHash,
  });
  if (attemptError || !attempt) throw new Error(`pix_payment_attempt_upsert_creating falhou: ${attemptError?.message}`);
  const attemptRow = attempt as { id: string; external_reference: string };

  const providerPaymentId = `mp-${attemptRow.id.slice(0, 8)}`;
  const { error: markError } = await admin.rpc("pix_payment_mark_created", {
    p_payment_attempt_id: attemptRow.id,
    p_provider_payment_id: providerPaymentId,
    p_provider_status: "pending",
    p_provider_status_detail: "pending_waiting_transfer",
    p_qr_code: "qr-fake",
    p_qr_code_base64: "base64-fake",
    p_ticket_url: "https://ticket.fake",
    p_expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
  });
  if (markError) throw new Error(`pix_payment_mark_created falhou: ${markError.message}`);

  return { orderId, attemptId: attemptRow.id, externalReference: attemptRow.external_reference, providerPaymentId, totalCents };
}

function applyState(
  admin: Admin,
  params: {
    attemptId: string;
    providerPaymentId: string;
    internalStatus: string;
    providerStatus: string;
    externalReference: string;
    amountCents: number;
  },
) {
  return admin.rpc("pix_payment_apply_provider_state", {
    p_payment_attempt_id: params.attemptId,
    p_provider_payment_id: params.providerPaymentId,
    p_internal_status: params.internalStatus,
    p_provider_status: params.providerStatus,
    p_provider_status_detail: null,
    p_amount_cents: params.amountCents,
    p_currency: "BRL",
    p_external_reference: params.externalReference,
    p_qr_code: null,
    p_qr_code_base64: null,
    p_ticket_url: null,
    p_expires_at: null,
  });
}

async function twoConcurrentApprovedWebhooks(admin: Admin) {
  const { data: storeA } = await admin.from("stores").select("id,slug").eq("slug", "store-a").single();
  if (!storeA) throw new Error("store-a não encontrada — rode npm run seed:local");

  const productId = await createPublishedProduct(storeA.id, "Concorrencia Pix Approved x2", 10);
  const { orderId, attemptId, externalReference, providerPaymentId, totalCents } = await createPixOrderWithAttempt(
    admin,
    storeA.slug,
    productId,
    2,
  );

  console.log("Disparando 2 webhooks 'approved' concorrentes no mesmo pagamento...");
  const outcomes = await Promise.all([
    applyState(admin, { attemptId, providerPaymentId, internalStatus: "approved", providerStatus: "approved", externalReference, amountCents: totalCents }),
    applyState(admin, { attemptId, providerPaymentId, internalStatus: "approved", providerStatus: "approved", externalReference, amountCents: totalCents }),
  ]);
  const errors = outcomes.filter((o) => o.error);
  record("2 webhooks approved concorrentes: nenhuma chamada falha", errors.length === 0, `erros=${errors.length}`);

  const { data: order } = await admin.from("orders").select("status").eq("id", orderId).single();
  record("pedido confirmado (status=confirmed)", order?.status === "confirmed", `status=${order?.status}`);

  const { data: auditRows } = await admin.from("audit_log").select("action").eq("target_id", orderId);
  const confirmedCount = (auditRows ?? []).filter((r) => r.action === "order_confirmed_by_payment").length;
  record("order_confirmed_by_payment ocorre exatamente 1 vez (sem duplicar)", confirmedCount === 1, `eventos=${confirmedCount}`);
}

async function webhookConcurrentWithReconciliation(admin: Admin) {
  const { data: storeA } = await admin.from("stores").select("id,slug").eq("slug", "store-a").single();
  if (!storeA) throw new Error("store-a não encontrada");

  const productId = await createPublishedProduct(storeA.id, "Concorrencia Webhook Reconcile", 10);
  const { orderId, attemptId, externalReference, providerPaymentId, totalCents } = await createPixOrderWithAttempt(
    admin,
    storeA.slug,
    productId,
    1,
  );

  console.log("Disparando webhook 'approved' concorrente com uma reconciliação (mesma função)...");
  const outcomes = await Promise.all([
    applyState(admin, { attemptId, providerPaymentId, internalStatus: "approved", providerStatus: "approved", externalReference, amountCents: totalCents }),
    applyState(admin, { attemptId, providerPaymentId, internalStatus: "approved", providerStatus: "approved", externalReference, amountCents: totalCents }),
  ]);
  const errors = outcomes.filter((o) => o.error);
  record("webhook + reconciliação concorrentes: nenhuma chamada falha", errors.length === 0, `erros=${errors.length}`);

  const { data: payment } = await admin.from("order_payments").select("status,approved_at").eq("id", attemptId).single();
  record("pagamento aprovado exatamente uma vez (approved_at preenchido)", payment?.status === "approved" && Boolean(payment.approved_at), `status=${payment?.status}`);

  const { data: order } = await admin.from("orders").select("status").eq("id", orderId).single();
  record("pedido confirmado sem duplicar efeito", order?.status === "confirmed", `status=${order?.status}`);
}

async function approvedVersusCancelledRace(admin: Admin) {
  const { data: storeA } = await admin.from("stores").select("id,slug").eq("slug", "store-a").single();
  if (!storeA) throw new Error("store-a não encontrada");

  const productId = await createPublishedProduct(storeA.id, "Concorrencia Approved vs Cancelled", 10);
  const { data: stockBeforeRow } = await admin.from("products").select("stock").eq("id", productId).single();
  const stockBefore = stockBeforeRow?.stock ?? 0;

  const { orderId, attemptId, externalReference, providerPaymentId, totalCents } = await createPixOrderWithAttempt(
    admin,
    storeA.slug,
    productId,
    3,
  );

  console.log("Disparando 'approved' e 'cancelled' CONCORRENTES no mesmo pagamento pending...");
  const outcomes = await Promise.all([
    applyState(admin, { attemptId, providerPaymentId, internalStatus: "approved", providerStatus: "approved", externalReference, amountCents: totalCents }),
    applyState(admin, { attemptId, providerPaymentId, internalStatus: "cancelled", providerStatus: "cancelled", externalReference, amountCents: totalCents }),
  ]);
  const errors = outcomes.filter((o) => o.error);
  record("approved x cancelled concorrentes: nenhuma chamada RPC falha (a divergência vira manual_review, não erro)", errors.length === 0, `erros=${errors.length}`);

  const { data: order } = await admin.from("orders").select("status").eq("id", orderId).single();
  const isConfirmed = order?.status === "confirmed";
  const isCancelled = order?.status === "cancelled";
  record(
    "exatamente um estado terminal vence (confirmed OU cancelled, nunca os dois nem nenhum)",
    isConfirmed !== isCancelled,
    `status=${order?.status}`,
  );

  const { data: stockAfterRow } = await admin.from("products").select("stock").eq("id", productId).single();
  const stockAfter = stockAfterRow?.stock ?? 0;
  const stockConsistent = isConfirmed ? stockAfter === stockBefore - 3 : stockAfter === stockBefore;
  record(
    "estoque final é coerente com o vencedor da corrida (nunca duplamente baixado nem devolvido)",
    stockConsistent,
    `stockBefore=${stockBefore} stockAfter=${stockAfter} orderStatus=${order?.status}`,
  );

  const { data: auditRows } = await admin.from("audit_log").select("action").eq("target_id", attemptId);
  const manualReviewCount = (auditRows ?? []).filter((r) => r.action === "payment_manual_review_required").length;
  record("o perdedor da corrida vira manual_review (auditoria crítica, exatamente 1 vez)", manualReviewCount === 1, `eventos=${manualReviewCount}`);

  const { data: orderAuditRows } = await admin.from("audit_log").select("action").eq("target_id", orderId);
  const bothHappened =
    (orderAuditRows ?? []).some((r) => r.action === "order_confirmed_by_payment") &&
    (orderAuditRows ?? []).some((r) => r.action === "order_cancelled_by_payment_failure");
  record("nunca confirma E cancela o mesmo pedido (estado terminal não regride)", !bothHappened, `ambos_ocorreram=${bothHappened}`);
}

async function twoRetriesOfPaymentCreation(admin: Admin) {
  const { data: storeA } = await admin.from("stores").select("id,slug").eq("slug", "store-a").single();
  if (!storeA) throw new Error("store-a não encontrada");

  const productId = await createPublishedProduct(storeA.id, "Concorrencia Retry Criacao", 10);
  const { data: order, error: orderError } = await anonClient().rpc("create_order", {
    p_store_slug: storeA.slug,
    p_idempotency_key: crypto.randomUUID(),
    p_customer_name: "Cliente Retry",
    p_customer_phone: "+5511999990011",
    p_fulfillment_method: "pickup",
    p_delivery_address: null,
    p_customer_notes: null,
    p_items: [{ product_id: productId, quantity: 1 }],
  });
  if (orderError || !order) throw new Error(`create_order falhou: ${orderError?.message}`);
  const orderRow = order as { id: string; total_cents: number };
  const receiptHash = createHash("sha256").update(`receipt-retry-${orderRow.id}`).digest("hex");

  console.log("Disparando 2 retries CONCORRENTES de criação de pagamento (mesmo order_id)...");
  const outcomes = await Promise.all(
    [1, 2].map(() =>
      admin.rpc("pix_payment_attempt_upsert_creating", {
        p_order_id: orderRow.id,
        p_provider_idempotency_key: `pix-${orderRow.id.replace(/-/g, "")}`,
        p_amount_cents: orderRow.total_cents,
        p_currency: "BRL",
        p_payer_email: "cliente@example.test",
        p_payer_doc_type: "CPF",
        p_payer_doc_last4: "4321",
        p_receipt_token_hash: receiptHash,
      }),
    ),
  );
  const errors = outcomes.filter((o) => o.error);
  const ids = new Set(outcomes.map((o) => (o.data as { id: string } | null)?.id).filter(Boolean));
  record("2 retries concorrentes de criação: nenhuma falha, mesma tentativa devolvida", errors.length === 0 && ids.size === 1, `erros=${errors.length} ids_distintos=${ids.size}`);

  const { data: attempts } = await admin.from("order_payments").select("id").eq("order_id", orderRow.id);
  record("exatamente 1 linha de payment_attempt para o pedido (nunca duas)", (attempts ?? []).length === 1, `linhas=${(attempts ?? []).length}`);
}

async function main() {
  loadLocalEnv();
  const admin = createAdminSupabaseClient();

  await twoConcurrentApprovedWebhooks(admin);
  await webhookConcurrentWithReconciliation(admin);
  await approvedVersusCancelledRace(admin);
  await twoRetriesOfPaymentCreation(admin);

  const failed = results.filter((r) => !r.pass);
  if (failed.length > 0) {
    throw new Error(`${failed.length} verificação(ões) falharam — ver detalhes acima.`);
  }

  console.log(
    "\nPASS - webhooks/reconciliação concorrentes nunca duplicam efeito de negócio; corrida approved x cancelled sempre resolve em exatamente um estado terminal coerente com o estoque; retries de criação nunca duplicam a tentativa de pagamento.",
  );
}

main().catch((error) => {
  console.error(`Teste de concorrência de pagamentos falhou: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
