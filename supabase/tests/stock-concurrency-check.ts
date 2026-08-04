/**
 * Teste real de concorrência para catalog_adjust_stock (TASK-003):
 * cinco chamadas concorrentes de ajuste de estoque, mais que o estoque
 * disponível suporta — só a UPDATE atômica com `stock + delta >= 0` no
 * próprio WHERE (supabase/migrations/0005_catalog.sql) pode garantir
 * que o estoque nunca fique negativo sob corrida real, não um
 * SELECT-depois-UPDATE separado.
 *
 * Também cobre, na mesma sessão real (sem precisar de outro script):
 *   - Storage: admin da própria loja consegue enviar/remover imagem no
 *     próprio caminho; admin de OUTRA loja não consegue enviar nem
 *     remover no caminho da loja alheia (RLS de storage.objects).
 *
 * Diferente de supabase/tests/catalog_isolation_check.sql (SAVEPOINTs
 * numa única sessão psql, sequencial por natureza), este script usa
 * conexões HTTP reais e independentes via supabase-js.
 *
 * Como rodar:
 *   npx supabase start && npx supabase db reset && npm run seed:local
 *   npx tsx supabase/tests/stock-concurrency-check.ts
 */
import { createClient } from "@supabase/supabase-js";
import { loadLocalEnv } from "../../lib/env/load-local-env";
import { createAdminSupabaseClient } from "../../lib/supabase/admin";
import { getPublicSupabaseEnv } from "../../lib/supabase/env";
import type { Database } from "../../lib/supabase/types";

const DEV_ONLY_PASSWORD = "dev-local-only-not-a-real-secret-123!";
const BUCKET = "product-images";

const results: { label: string; pass: boolean; detail: string }[] = [];
function record(label: string, pass: boolean, detail: string) {
  results.push({ label, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} - ${label}: ${detail}`);
}

async function signIn(email: string) {
  const env = getPublicSupabaseEnv();
  const client = createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const { error } = await client.auth.signInWithPassword({ email, password: DEV_ONLY_PASSWORD });
  if (error) throw new Error(`login falhou para ${email}: ${error.message}`);
  return client;
}

async function stockConcurrency(admin: ReturnType<typeof createAdminSupabaseClient>) {
  const { data: storeA } = await admin.from("stores").select("id").eq("slug", "store-a").single();
  if (!storeA) throw new Error("store-a não encontrada — rode npm run seed:local");

  const clientA = await signIn("admin-a@example.test");

  const { data: product, error: createError } = await clientA.rpc("catalog_create_product", {
    p_store_id: storeA.id,
    p_name: "Estoque Concorrente",
    p_slug: "estoque-concorrente-" + Date.now(),
    p_price_cents: 500,
    p_stock: 10,
  });
  if (createError || !product) throw new Error(`criação do produto falhou: ${createError?.message}`);

  const clients = Array.from({ length: 5 }, () =>
    createClient<Database>(getPublicSupabaseEnv().NEXT_PUBLIC_SUPABASE_URL, getPublicSupabaseEnv().NEXT_PUBLIC_SUPABASE_ANON_KEY),
  );
  for (const c of clients) {
    const {
      data: { session },
    } = await clientA.auth.getSession();
    if (!session) throw new Error("sessão do admin A ausente");
    const { error } = await c.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token });
    if (error) throw new Error(`setSession falhou: ${error.message}`);
  }

  console.log("Disparando 5 ajustes concorrentes de -3 sobre um estoque inicial de 10...");
  const outcomes = await Promise.all(
    clients.map((c) => c.rpc("catalog_adjust_stock", { p_product_id: product.id, p_delta: -3, p_reason: "venda concorrente", p_reference: null })),
  );

  const successes = outcomes.filter((o) => !o.error);
  const failures = outcomes.filter((o) => o.error);

  record("Exatamente 3 dos 5 ajustes têm sucesso (10 -> 7 -> 4 -> 1, o 4º e 5º ficariam negativos)", successes.length === 3, `sucessos=${successes.length}`);
  record(
    "As 2 falhas restantes são todas stock_would_be_negative (nunca outro erro)",
    failures.length === 2 && failures.every((f) => f.error?.message === "stock_would_be_negative"),
    `falhas=${JSON.stringify(failures.map((f) => f.error?.message))}`,
  );

  const { data: finalProduct } = await admin.from("products").select("stock").eq("id", product.id).single();
  record("Estoque final é exatamente 1 (nunca negativo)", finalProduct?.stock === 1, `stock=${finalProduct?.stock}`);

  const { data: auditRows } = await admin
    .from("audit_log")
    .select("id")
    .eq("target_id", product.id)
    .eq("action", "product_stock_adjusted");
  record(
    "Exatamente 3 eventos product_stock_adjusted (um por ajuste bem-sucedido, sem duplicar)",
    (auditRows ?? []).length === 3,
    `eventos=${(auditRows ?? []).length}`,
  );

  await admin.from("products").delete().eq("id", product.id);
}

async function storageIsolation(admin: ReturnType<typeof createAdminSupabaseClient>) {
  const { data: storeA } = await admin.from("stores").select("id").eq("slug", "store-a").single();
  if (!storeA) throw new Error("store-a não encontrada");

  const clientA = await signIn("admin-a@example.test");
  const clientB = await signIn("admin-b@example.test");

  const fakeJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
  const productId = crypto.randomUUID();
  const path = `${storeA.id}/${productId}/teste.jpg`;

  const uploadByOwner = await clientA.storage.from(BUCKET).upload(path, fakeJpeg, { contentType: "image/jpeg" });
  record("Admin A (dono da loja) consegue enviar imagem no próprio caminho", !uploadByOwner.error, `error=${uploadByOwner.error?.message ?? "null"}`);

  const otherPath = `${storeA.id}/${productId}/invasao.jpg`;
  const uploadByOther = await clientB.storage.from(BUCKET).upload(otherPath, fakeJpeg, { contentType: "image/jpeg" });
  record(
    "Admin B (outra loja) NÃO consegue enviar imagem no caminho de store-a",
    Boolean(uploadByOther.error),
    `error=${uploadByOther.error?.message ?? "nenhum — deveria ter falhado"}`,
  );

  const deleteByOther = await clientB.storage.from(BUCKET).remove([path]);
  const stillThereAfterOtherDelete = await admin.storage.from(BUCKET).list(`${storeA.id}/${productId}`);
  record(
    "Admin B (outra loja) NÃO consegue remover imagem de store-a — arquivo continua lá",
    (stillThereAfterOtherDelete.data ?? []).some((f) => f.name === "teste.jpg"),
    `remove.error=${deleteByOther.error?.message ?? "sem erro reportado"}, arquivos=${JSON.stringify(stillThereAfterOtherDelete.data?.map((f) => f.name))}`,
  );

  const deleteByOwner = await clientA.storage.from(BUCKET).remove([path]);
  record("Admin A (dono) consegue remover a própria imagem", !deleteByOwner.error, `error=${deleteByOwner.error?.message ?? "null"}`);

  await admin.storage.from(BUCKET).remove([path, otherPath]);
}

async function main() {
  loadLocalEnv();
  const admin = createAdminSupabaseClient();

  await stockConcurrency(admin);
  await storageIsolation(admin);

  const failed = results.filter((r) => !r.pass);
  if (failed.length > 0) {
    throw new Error(`${failed.length} verificação(ões) falharam — ver detalhes acima.`);
  }

  console.log("\nPASS - estoque nunca fica negativo sob concorrência real; Storage isola upload/remoção por loja.");
}

main().catch((error) => {
  console.error(`Teste de concorrência de estoque/Storage falhou: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
