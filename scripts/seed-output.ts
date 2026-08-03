import { FIXTURE_USERS } from "../lib/data/fixtures";

export interface SeedIdentifiers {
  adminAId: string;
  adminBId: string;
  clienteAId: string;
  clienteBId: string;
  storeAId: string;
  storeBId: string;
  merchantOnboardingId: string;
  merchantPendingId: string;
  pendingStoreId: string;
  merchantSuspendedId: string;
  suspendedStoreId: string;
  merchantMultiId: string;
  multiStoreId: string;
}

/**
 * Imprime só os identificadores não sensíveis necessários para rodar
 * supabase/tests/isolation_check.sql manualmente. A assinatura desta
 * função é a própria trava: como ela não recebe senha/token/chave como
 * parâmetro, não há como um segredo vazar por aqui, nem por engano numa
 * edição futura (FINAL-BUG-002, qa/reports/TASK-001-RETEST-3.md).
 */
export function logSeedSummary(ids: SeedIdentifiers): void {
  console.log("Seed local concluído.\n");
  console.log("IDs para uso em supabase/tests/isolation_check.sql:");
  console.log(`  admin-a (${FIXTURE_USERS.adminA.email}): ${ids.adminAId}`);
  console.log(`  admin-b (${FIXTURE_USERS.adminB.email}): ${ids.adminBId}`);
  console.log(`  cliente-a (${FIXTURE_USERS.clienteA.email}): ${ids.clienteAId}`);
  console.log(`  cliente-b (${FIXTURE_USERS.clienteB.email}): ${ids.clienteBId}`);
  console.log(`  store-a: ${ids.storeAId}`);
  console.log(`  store-b: ${ids.storeBId}`);
  console.log(`  merchant-onboarding (${ONBOARDING_EMAIL.merchantOnboarding}): ${ids.merchantOnboardingId}`);
  console.log(`  merchant-pending (${ONBOARDING_EMAIL.merchantPending}): ${ids.merchantPendingId}`);
  console.log(`  loja-pendente-fixture: ${ids.pendingStoreId}`);
  console.log(`  merchant-suspended (${ONBOARDING_EMAIL.merchantSuspended}): ${ids.merchantSuspendedId}`);
  console.log(`  loja-suspensa-fixture: ${ids.suspendedStoreId}`);
  console.log(`  merchant-multi (${ONBOARDING_EMAIL.merchantMulti}): ${ids.merchantMultiId}`);
  console.log(`  loja-multi-fixture: ${ids.multiStoreId}`);
}

const ONBOARDING_EMAIL = {
  merchantOnboarding: "merchant-onboarding@example.test",
  merchantPending: "merchant-pending@example.test",
  merchantSuspended: "merchant-suspended@example.test",
  merchantMulti: "merchant-multi@example.test",
} as const;

/**
 * Imprime só a mensagem de erro — nunca o objeto/erro completo. Alguns
 * clientes HTTP anexam detalhes da requisição (headers, corpo, cookies)
 * em propriedades extras de um Error; um `console.error(error)` ingênuo
 * imprimiria isso junto. Extrair apenas `.message` evita esse vetor
 * mesmo sem conhecer o formato exato de todo erro possível.
 */
export function logSeedFailure(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Seed local falhou: ${message}`);
}
