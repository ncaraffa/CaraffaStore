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
 *   - Concorrência de imagens (correção pós-QA, BUG-CLAUDE-003-003):
 *     4 imagens + 2 inserções concorrentes (exatamente 1 sucede, total
 *     final 5), 0 imagens + 6 concorrentes (nunca mais de 5), 5 imagens
 *     + 1 nova (sempre rejeitada) — só o `select ... for update` em
 *     catalog_add_product_image (0005_catalog.sql) serializa a corrida
 *     que antes permitia ultrapassar o limite; cross-tenant e
 *     pending_payment/suspended também são cobertos aqui, além da
 *     regressão de capa única/promoção determinística.
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

/**
 * Correção pós-QA (qa/reports/TASK-003-CLAUDE-VERIFICATION.md,
 * BUG-CLAUDE-003-003): o limite de 5 imagens por produto era garantido
 * só por um SELECT COUNT(*) antes do INSERT (trigger
 * check_product_image_constraints), um TOCTOU (check-then-act)
 * clássico — reproduzido 3/3 vezes com 2 inserções concorrentes e 4
 * imagens já existentes, resultando em 6 imagens. Corrigido em
 * catalog_add_product_image (0005_catalog.sql) com um
 * `select ... for update` na linha do produto, que serializa qualquer
 * concorrência de inserção de imagem para o MESMO produto. Este teste
 * cobre exatamente os 3 cenários exigidos na correção: 4+2, 0+6 e 5+1.
 */
async function imageConcurrency(admin: ReturnType<typeof createAdminSupabaseClient>) {
  const { data: storeA } = await admin.from("stores").select("id").eq("slug", "store-a").single();
  const { data: storeB } = await admin.from("stores").select("id").eq("slug", "store-b").single();
  const { data: pendingStore } = await admin.from("stores").select("id").eq("slug", "loja-pendente-fixture").single();
  const { data: suspendedStore } = await admin.from("stores").select("id").eq("slug", "loja-suspensa-fixture").single();
  if (!storeA || !storeB || !pendingStore || !suspendedStore) throw new Error("fixtures ausentes — rode npm run seed:local");

  const clientA = await signIn("admin-a@example.test");
  const clientB = await signIn("admin-b@example.test");
  const clientPending = await signIn("merchant-pending@example.test");
  const clientSuspended = await signIn("merchant-suspended@example.test");

  async function siblingClient(of: Awaited<ReturnType<typeof signIn>>) {
    const env = getPublicSupabaseEnv();
    const c = createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
    const {
      data: { session },
    } = await of.auth.getSession();
    if (!session) throw new Error("sessão ausente para clonar");
    await c.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token });
    return c;
  }

  async function createProduct(client: Awaited<ReturnType<typeof signIn>>, storeId: string, name: string) {
    const { data, error } = await client.rpc("catalog_create_product", {
      p_store_id: storeId,
      p_name: name,
      p_slug: name.toLowerCase().replace(/\s+/g, "-") + "-" + Date.now(),
      p_price_cents: 100,
      p_stock: 1,
    });
    if (error || !data) throw new Error(`criação do produto (${name}) falhou: ${error?.message}`);
    return data as { id: string };
  }

  // Cenário 1: 4 imagens já existentes + 2 inserções concorrentes -> exatamente 1 sucede, total final 5.
  {
    const product = await createProduct(clientA, storeA.id, "Img Concorrencia 4mais2");
    for (let i = 0; i < 4; i++) {
      const { error } = await clientA.rpc("catalog_add_product_image", {
        p_product_id: product.id,
        p_storage_path: `${storeA.id}/${product.id}/seed-${i}.jpg`,
      });
      if (error) throw new Error(`seed de imagem ${i} falhou: ${error.message}`);
    }
    const c1 = await siblingClient(clientA);
    const c2 = await siblingClient(clientA);
    const [r1, r2] = await Promise.all([
      c1.rpc("catalog_add_product_image", { p_product_id: product.id, p_storage_path: `${storeA.id}/${product.id}/conc-x.jpg` }),
      c2.rpc("catalog_add_product_image", { p_product_id: product.id, p_storage_path: `${storeA.id}/${product.id}/conc-y.jpg` }),
    ]);
    const successes = [r1, r2].filter((r) => !r.error).length;
    const { data: finalImages } = await admin.from("product_images").select("id").eq("product_id", product.id);
    record(
      "4 imagens + 2 inserções concorrentes: exatamente 1 sucede, total final 5",
      successes === 1 && (finalImages ?? []).length === 5,
      `sucessos=${successes} total=${(finalImages ?? []).length}`,
    );
    await admin.from("products").delete().eq("id", product.id);
  }

  // Cenário 2: 0 imagens + 6 inserções concorrentes -> nunca mais de 5 sucedem, total nunca ultrapassa 5.
  {
    const product = await createProduct(clientA, storeA.id, "Img Concorrencia 0mais6");
    const clients = await Promise.all(Array.from({ length: 6 }, () => siblingClient(clientA)));
    const outcomes = await Promise.all(
      clients.map((c, i) => c.rpc("catalog_add_product_image", { p_product_id: product.id, p_storage_path: `${storeA.id}/${product.id}/six-${i}.jpg` })),
    );
    const successes = outcomes.filter((o) => !o.error).length;
    const { data: finalImages } = await admin.from("product_images").select("id").eq("product_id", product.id);
    record(
      "0 imagens + 6 inserções concorrentes: no máximo 5 sucessos, total nunca ultrapassa 5",
      successes <= 5 && (finalImages ?? []).length <= 5,
      `sucessos=${successes} total=${(finalImages ?? []).length}`,
    );
    await admin.from("products").delete().eq("id", product.id);
  }

  // Cenário 3: 5 imagens já existentes + nova inserção -> sempre rejeitada, total continua 5.
  {
    const product = await createProduct(clientA, storeA.id, "Img Concorrencia 5mais1");
    for (let i = 0; i < 5; i++) {
      const { error } = await clientA.rpc("catalog_add_product_image", {
        p_product_id: product.id,
        p_storage_path: `${storeA.id}/${product.id}/seed-${i}.jpg`,
      });
      if (error) throw new Error(`seed de imagem ${i} falhou: ${error.message}`);
    }
    const { error: overflowError } = await clientA.rpc("catalog_add_product_image", {
      p_product_id: product.id,
      p_storage_path: `${storeA.id}/${product.id}/overflow.jpg`,
    });
    const { data: finalImages } = await admin.from("product_images").select("id").eq("product_id", product.id);
    record(
      "5 imagens existentes + nova inserção: rejeitada, total continua 5",
      Boolean(overflowError) && (finalImages ?? []).length === 5,
      `error=${overflowError?.message ?? "nenhum — deveria ter falhado"} total=${(finalImages ?? []).length}`,
    );
    await admin.from("products").delete().eq("id", product.id);
  }

  // Loja B não insere imagem em produto da Loja A.
  {
    const product = await createProduct(clientA, storeA.id, "Img Cross Tenant");
    const { error } = await clientB.rpc("catalog_add_product_image", { p_product_id: product.id, p_storage_path: `${storeA.id}/${product.id}/invasao.jpg` });
    record("Admin B NÃO insere imagem em produto da Loja A", Boolean(error), `error=${error?.message ?? "nenhum — deveria ter falhado"}`);
    await admin.from("products").delete().eq("id", product.id);
  }

  // pending_payment/suspended não inserem imagem (BUG-CLAUDE-003-001) —
  // produto criado via service_role (a própria criação via RPC já é
  // negada para essas lojas, ver supabase/tests/catalog_isolation_check.sql
  // Casos 29-38; aqui o alvo é especificamente catalog_add_product_image).
  for (const [label, client, store] of [
    ["pending_payment", clientPending, pendingStore] as const,
    ["suspended", clientSuspended, suspendedStore] as const,
  ]) {
    const { data: product, error: seedError } = await admin
      .from("products")
      .insert({ store_id: store.id, name: `Img ${label} setup`, stock: 1, price_cents: 100 })
      .select("id")
      .single();
    if (seedError || !product) throw new Error(`seed de produto para ${label} falhou: ${seedError?.message}`);
    const { error } = await client.rpc("catalog_add_product_image", { p_product_id: product.id, p_storage_path: `${store.id}/${product.id}/x.jpg` });
    record(`Loja ${label} NÃO insere imagem (catalog_add_product_image)`, Boolean(error), `error=${error?.message ?? "nenhum — deveria ter falhado"}`);
    await admin.from("products").delete().eq("id", product.id);
  }

  // Regressão: capa única e promoção determinística da próxima imagem
  // ao remover a capa continuam corretas após o fix de concorrência.
  {
    const product = await createProduct(clientA, storeA.id, "Img Cover Regressao");
    const images: { id: string; is_cover: boolean }[] = [];
    for (let i = 0; i < 3; i++) {
      const { data } = await clientA.rpc("catalog_add_product_image", { p_product_id: product.id, p_storage_path: `${storeA.id}/${product.id}/c-${i}.jpg` });
      images.push(data as { id: string; is_cover: boolean });
    }
    const cover = images.find((i) => i.is_cover)!;
    const { error: removeError } = await clientA.rpc("catalog_remove_product_image", { p_image_id: cover.id });
    const { data: remaining } = await admin.from("product_images").select("id,position,is_cover").eq("product_id", product.id).order("position");
    const newCover = (remaining ?? []).find((i) => i.is_cover);
    const expectedNext = [...(remaining ?? [])].sort((a, b) => a.position - b.position)[0];
    record(
      "remoção da capa promove deterministicamente a próxima imagem (menor position)",
      !removeError && Boolean(newCover) && Boolean(expectedNext) && newCover?.id === expectedNext?.id,
      `capa=${newCover?.id} esperado=${expectedNext?.id}`,
    );
    record("no máximo 1 capa após a promoção", (remaining ?? []).filter((i) => i.is_cover).length === 1, `capas=${(remaining ?? []).filter((i) => i.is_cover).length}`);
    await admin.from("products").delete().eq("id", product.id);
  }
}

async function main() {
  loadLocalEnv();
  const admin = createAdminSupabaseClient();

  await stockConcurrency(admin);
  await storageIsolation(admin);
  await imageConcurrency(admin);

  const failed = results.filter((r) => !r.pass);
  if (failed.length > 0) {
    throw new Error(`${failed.length} verificação(ões) falharam — ver detalhes acima.`);
  }

  console.log(
    "\nPASS - estoque nunca fica negativo sob concorrência real; Storage isola upload/remoção por loja; limite de 5 imagens nunca é ultrapassado sob concorrência real.",
  );
}

main().catch((error) => {
  console.error(`Teste de concorrência de estoque/Storage falhou: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
