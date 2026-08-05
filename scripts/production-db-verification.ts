/**
 * Verificação READ-ONLY pós-migration de um projeto Supabase (destinado a
 * produção, mas funciona contra qualquer projeto). Nunca escreve, nunca
 * faz reset, nunca aplica seed. Só leituras via REST (PostgREST) com a
 * anon key e a service role key do projeto apontado por
 * NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY /
 * SUPABASE_SERVICE_ROLE_KEY.
 *
 * Uso (aponte .env.local ou variáveis de shell para o projeto de
 * PRODUÇÃO antes de rodar — nunca comita nem loga as chaves):
 *   npx tsx scripts/production-db-verification.ts
 *
 * O que confirma (cada item é reportado com PASS/FAIL, exit code 1 se
 * qualquer item obrigatório falhar):
 * 1. Conectividade com o Postgres via REST.
 * 2. Tabelas-chave de cada migration (0001–0007) existem.
 * 3. Grants mínimos: anon é REALMENTE barrado (erro de permissão, não só
 *    0 linhas) em tabelas sem nenhum grant para anon (ex.: audit_log,
 *    payment_webhook_events).
 * 4. Funções críticas (SECURITY DEFINER) existem e reagem a input
 *    inválido com erro de validação — não "function does not exist".
 * 5. Bucket "product-images" existe e está público.
 * 6. Nenhuma fixture local conhecida (usuários @example.test, lojas
 *    store-a/store-b/*-fixture) está presente.
 *
 * Limitação conhecida: PostgREST não expõe introspecção de
 * information_schema/pg_catalog, então esta verificação NÃO confirma
 * diretamente "RLS habilitada" nem varre todo o banco por DML perigoso —
 * infere grants/RLS pelo comportamento observável (permissão negada) e
 * documenta a limitação no relatório final. Para uma auditoria completa
 * de schema, use o SQL Editor do painel Supabase.
 */
import { loadLocalEnv } from "../lib/env/load-local-env";
import { createClient } from "@supabase/supabase-js";
import { getPublicSupabaseEnv, getServiceRoleEnv } from "../lib/supabase/env";

type CheckResult = { name: string; ok: boolean; detail: string };

const results: CheckResult[] = [];

function record(name: string, ok: boolean, detail: string) {
  results.push({ name, ok, detail });
}

const EXPECTED_TABLES = [
  "stores",
  "store_members",
  "products",
  "merchant_profiles",
  "onboarding_progress",
  "store_plans",
  "audit_log",
  "categories",
  "product_images",
  "orders",
  "order_items",
  "store_payment_settings",
  "order_payments",
  "payment_webhook_events",
];

// Tabelas sem NENHUM grant para anon (revoke all + nenhum grant de volta)
// — anon consultando via REST deve receber erro de permissão (42501/403),
// nunca 0 linhas silenciosas.
const ANON_MUST_BE_DENIED_TABLES = ["audit_log", "payment_webhook_events", "store_payment_settings"];

const KNOWN_FIXTURE_EMAILS_SUFFIX = "@example.test";
const KNOWN_FIXTURE_SLUGS = [
  "store-a",
  "store-b",
  "loja-pendente-fixture",
  "loja-suspensa-fixture",
  "loja-multi-fixture",
];

async function main() {
  loadLocalEnv();

  const { NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY } = getPublicSupabaseEnv();
  const { SUPABASE_SERVICE_ROLE_KEY } = getServiceRoleEnv();

  console.log(`Verificando projeto: ${NEXT_PUBLIC_SUPABASE_URL}\n(nenhuma chave será exibida)\n`);

  const admin = createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const anon = createClient(NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 1. Conectividade
  try {
    const { error } = await admin.from("stores").select("id").limit(1);
    record("conectividade", !error, error ? error.message : "OK");
  } catch (error) {
    record("conectividade", false, String(error));
  }

  // 2. Tabelas-chave presentes (service role sempre bypassa RLS — erro
  // aqui só ocorre se a tabela não existir de verdade).
  for (const table of EXPECTED_TABLES) {
    try {
      const { error } = await admin.from(table).select("*", { head: true, count: "exact" });
      const missing = error?.code === "PGRST205" || error?.message?.includes("does not exist");
      record(`tabela ${table}`, !error || !missing, error && missing ? "tabela ausente" : error?.message ?? "OK");
    } catch (error) {
      record(`tabela ${table}`, false, String(error));
    }
  }

  // 3. Grants mínimos — anon deve ser negado com erro de permissão
  for (const table of ANON_MUST_BE_DENIED_TABLES) {
    try {
      const { error, status } = await anon.from(table).select("id").limit(1);
      const denied = status === 401 || status === 403 || error?.code === "42501" || error?.code === "PGRST301";
      record(
        `grants: anon negado em ${table}`,
        denied,
        denied ? "OK (permissão negada, como esperado)" : `INESPERADO: status=${status} code=${error?.code ?? "-"}`,
      );
    } catch (error) {
      record(`grants: anon negado em ${table}`, false, String(error));
    }
  }

  // 4. Funções críticas existem (chamadas com parâmetro claramente
  // inválido — o objetivo é distinguir "function does not exist" de
  // qualquer outro erro de validação de negócio, que prova que a função
  // existe e está executando).
  async function checkFunctionExists(name: string, call: () => Promise<{ error: { message: string } | null }>) {
    try {
      const { error } = await call();
      const missing = error?.message?.toLowerCase().includes("could not find the function");
      record(`função ${name}`, !missing, missing ? "função ausente" : "OK (existe e respondeu)");
    } catch (error) {
      record(`função ${name}`, false, String(error));
    }
  }

  await checkFunctionExists("is_slug_available", async () => admin.rpc("is_slug_available", { p_slug: "___verificacao___" }));
  await checkFunctionExists("create_order", async () =>
    admin.rpc("create_order", {
      p_store_slug: "___verificacao-inexistente___",
      p_idempotency_key: "00000000-0000-0000-0000-000000000000",
      p_customer_name: "verificacao",
      p_customer_phone: "0",
      p_fulfillment_method: "pickup",
      p_delivery_address: null,
      p_customer_notes: null,
      p_items: [],
    }),
  );

  // 5. Bucket de imagens
  try {
    const { data, error } = await admin.storage.listBuckets();
    const bucket = data?.find((b) => b.id === "product-images");
    record(
      "bucket product-images",
      !error && !!bucket && bucket.public === true,
      error ? error.message : bucket ? `público=${bucket.public}` : "bucket ausente",
    );
  } catch (error) {
    record("bucket product-images", false, String(error));
  }

  // 6. Ausência de fixtures locais conhecidas
  try {
    const { data, error } = await admin.from("stores").select("slug").in("slug", KNOWN_FIXTURE_SLUGS);
    record(
      "sem lojas fixture conhecidas",
      !error && (data?.length ?? 0) === 0,
      error ? error.message : `${data?.length ?? 0} loja(s) fixture encontrada(s)`,
    );
  } catch (error) {
    record("sem lojas fixture conhecidas", false, String(error));
  }

  try {
    const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
    const fixtureUsers = (data?.users ?? []).filter((u) => u.email?.endsWith(KNOWN_FIXTURE_EMAILS_SUFFIX));
    record(
      "sem usuários fixture conhecidos",
      !error && fixtureUsers.length === 0,
      error ? error.message : `${fixtureUsers.length} usuário(s) fixture encontrado(s)`,
    );
  } catch (error) {
    record("sem usuários fixture conhecidos", false, String(error));
  }

  console.log("Resultado:\n");
  let allOk = true;
  for (const r of results) {
    if (!r.ok) allOk = false;
    console.log(`${r.ok ? "PASS" : "FAIL"} — ${r.name}: ${r.detail}`);
  }

  console.log(
    "\nLimitação conhecida: esta verificação não confirma diretamente RLS habilitada nem varre o banco " +
      "por DML perigoso (PostgREST não expõe information_schema/pg_catalog) — infere pelo comportamento " +
      "observável de grants. Para auditoria completa de schema, use o SQL Editor do painel Supabase.",
  );

  process.exitCode = allOk ? 0 : 1;
}

main().catch((error) => {
  console.error(`production-db-verification falhou: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
