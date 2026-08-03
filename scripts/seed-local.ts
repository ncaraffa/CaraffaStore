/**
 * Seeds Loja A (Mercado Aurora) e Loja B (Empório Horizonte) num Supabase
 * local, exatamente como descrito em docs/TESTING.md. Dev-only: usa a
 * service role key e NUNCA deve ser apontado para um projeto com dados
 * reais.
 *
 * Uso:
 *   npx supabase start
 *   npx supabase db reset
 *   npm run seed:local
 */
import { loadLocalEnv } from "../lib/env/load-local-env";
import { createAdminSupabaseClient } from "../lib/supabase/admin";
import { FIXTURE_PRODUCTS, FIXTURE_STORES, FIXTURE_USERS } from "../lib/data/fixtures";
import { logSeedFailure, logSeedSummary } from "./seed-output";

// Usada apenas para satisfazer o requisito de senha do Supabase Auth ao
// criar os usuários fictícios locais — nunca impressa em log (ver
// scripts/seed-output.ts e qa/reports/TASK-001-RETEST-3.md,
// FINAL-BUG-002).
const DEV_ONLY_PASSWORD = "dev-local-only-not-a-real-secret-123!";

async function ensureUser(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  email: string,
): Promise<string> {
  const { data: existing } = await admin.auth.admin.listUsers();
  const found = existing.users.find((u) => u.email === email);
  if (found) return found.id;

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: DEV_ONLY_PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`Falha ao criar usuário ${email}: ${error?.message}`);
  }
  return data.user.id;
}

async function ensureStore(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  slug: string,
  name: string,
): Promise<string> {
  const { data: existing } = await admin
    .from("stores")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  if (existing) return existing.id;

  const { data, error } = await admin
    .from("stores")
    .insert({ slug, name })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`Falha ao criar loja ${slug}: ${error?.message}`);
  }
  return data.id;
}

async function ensureMembership(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  storeId: string,
  userId: string,
  role: "owner" | "admin" | "staff",
) {
  await admin
    .from("store_members")
    .upsert({ store_id: storeId, user_id: userId, role }, { onConflict: "store_id,user_id" });
}

async function ensureProduct(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  storeId: string,
  name: string,
  stock: number,
) {
  await admin
    .from("products")
    .upsert({ store_id: storeId, name, stock }, { onConflict: "store_id,name" });
}

async function main() {
  // `tsx scripts/seed-local.ts` roda fora do runtime do Next.js, que é
  // quem normalmente carrega .env.local sozinho (next dev/build/start).
  // Sem esta chamada explícita, o script só funcionaria se as variáveis
  // já estivessem exportadas manualmente no shell.
  const { loadedEnvFiles } = loadLocalEnv();
  if (loadedEnvFiles.length > 0) {
    console.log(`Ambiente carregado de: ${loadedEnvFiles.join(", ")}\n`);
  }

  const admin = createAdminSupabaseClient();

  const adminAId = await ensureUser(admin, FIXTURE_USERS.adminA.email);
  const clienteAId = await ensureUser(admin, FIXTURE_USERS.clienteA.email);
  const adminBId = await ensureUser(admin, FIXTURE_USERS.adminB.email);
  const clienteBId = await ensureUser(admin, FIXTURE_USERS.clienteB.email);

  const storeAId = await ensureStore(
    admin,
    FIXTURE_STORES.storeA.slug,
    FIXTURE_STORES.storeA.name,
  );
  const storeBId = await ensureStore(
    admin,
    FIXTURE_STORES.storeB.slug,
    FIXTURE_STORES.storeB.name,
  );

  // Só admin-a/admin-b são membros de staff — cliente-a/cliente-b ficam
  // sem vínculo de propósito, representando clientes finais autenticados.
  await ensureMembership(admin, storeAId, adminAId, "admin");
  await ensureMembership(admin, storeBId, adminBId, "admin");

  for (const product of FIXTURE_PRODUCTS) {
    const storeId =
      product.storeId === FIXTURE_STORES.storeA.id ? storeAId : storeBId;
    await ensureProduct(admin, storeId, product.name, product.stock);
  }

  logSeedSummary({
    adminAId,
    adminBId,
    clienteAId,
    clienteBId,
    storeAId,
    storeBId,
  });
}

main().catch((error) => {
  logSeedFailure(error);
  process.exitCode = 1;
});
