/**
 * Catálogo comercial de planos no lado da aplicação — espelha
 * `platform_plans` (supabase/migrations/0012_plan_entitlements.sql).
 *
 * TASK-012: a identidade do plano é `planKey`
 * ('essential'|'growth'|'professional'), NUNCA o preço. O código legado
 * `plan_code` (30/50/80 — com o Profissional custando R$70 sob o código
 * 80) sobrevive apenas como ponte de compatibilidade em
 * `legacyPlanCode`, e sai de cena na fase contract.
 *
 * Esta lista é só para EXIBIÇÃO e para decidir o que mostrar/esconder na
 * UI. Nenhuma autorização pode derivar daqui:
 *
 *   - o valor cobrado sai sempre de `platform_plans.price_cents` no
 *     banco, no momento da criação da cobrança;
 *   - os limites com enforcement real saem sempre de
 *     `store_entitlements()` / `workspace_entitlements()` no banco.
 *
 * Um `planKey` vindo do navegador nunca concede nada: ou casa com o
 * catálogo do banco, ou vira `invalid_plan`.
 */

export type PlanKey = "essential" | "growth" | "professional";

/** Código legado por preço. Só existe para a transição expand/contract. */
export type LegacyPlanCode = 30 | 50 | 80;

export interface PlanEntitlements {
  maxProducts: number;
  maxImagesPerProduct: number;
  maxStores: number;
  maxTeamMembers: number;
  coupons: boolean;
  prioritySupport: boolean;
  setupAssistance: boolean;
  storeReview: boolean;
  implementationSupport: boolean;
}

export interface PlatformPlan {
  planKey: PlanKey;
  label: string;
  /** Centavos, sempre — nunca reais. */
  priceCents: number;
  tier: number;
  featured: boolean;
  legacyPlanCode: LegacyPlanCode;
  entitlementVersion: number;
  entitlements: PlanEntitlements;

  /**
   * @deprecated Compatibilidade de TRANSIÇÃO com as telas que ainda
   * falam plan_code/preço-em-reais (onboarding, assinatura, admin,
   * landing). São campos DERIVADOS — `code` é `legacyPlanCode` e
   * `price` é `priceCents / 100`. Nenhum dos dois pode ser usado para
   * decidir autorização nem para calcular cobrança: o servidor deriva
   * ambos do banco. Some quando essas telas migrarem para planKey
   * (commit de frontend) e na fase contract do banco.
   */
  code: LegacyPlanCode;
  /** @deprecated Ver `code`. Preço em reais, só para exibição. */
  price: number;
}

export const ENTITLEMENT_VERSION = 1;

export const PLATFORM_PLANS: readonly PlatformPlan[] = [
  {
    planKey: "essential",
    label: "Essencial",
    priceCents: 3000,
    tier: 1,
    featured: false,
    legacyPlanCode: 30,
    code: 30,
    price: 30,
    entitlementVersion: ENTITLEMENT_VERSION,
    entitlements: {
      maxProducts: 75,
      maxImagesPerProduct: 1,
      maxStores: 1,
      maxTeamMembers: 1,
      coupons: false,
      prioritySupport: false,
      setupAssistance: false,
      storeReview: false,
      implementationSupport: false,
    },
  },
  {
    planKey: "growth",
    label: "Crescimento",
    priceCents: 5000,
    tier: 2,
    featured: true,
    legacyPlanCode: 50,
    code: 50,
    price: 50,
    entitlementVersion: ENTITLEMENT_VERSION,
    entitlements: {
      maxProducts: 350,
      maxImagesPerProduct: 5,
      maxStores: 1,
      maxTeamMembers: 3,
      coupons: true,
      prioritySupport: true,
      setupAssistance: true,
      storeReview: true,
      implementationSupport: false,
    },
  },
  {
    planKey: "professional",
    label: "Profissional",
    priceCents: 7000,
    tier: 3,
    featured: false,
    legacyPlanCode: 80,
    code: 80,
    price: 70,
    entitlementVersion: ENTITLEMENT_VERSION,
    entitlements: {
      maxProducts: 1000,
      maxImagesPerProduct: 10,
      maxStores: 3,
      maxTeamMembers: 10,
      coupons: true,
      prioritySupport: true,
      setupAssistance: true,
      storeReview: true,
      implementationSupport: true,
    },
  },
];

export function isPlanKey(value: unknown): value is PlanKey {
  return value === "essential" || value === "growth" || value === "professional";
}

/**
 * Aceita planKey (forma nova) ou plan_code legado (30/50/80) enquanto as
 * telas antigas não migram. A resolução é sempre contra o catálogo — um
 * valor forjado vira erro, nunca um plano arbitrário.
 */
export function getPlatformPlan(plan: PlanKey | LegacyPlanCode | number): PlatformPlan {
  const found = PLATFORM_PLANS.find(
    (candidate) => candidate.planKey === plan || candidate.legacyPlanCode === plan,
  );
  if (!found) {
    throw new Error(`unknown_plan:${plan}`);
  }
  return found;
}

/** Ponte legada — usada só onde ainda existe plan_code em trânsito. */
export function planKeyFromLegacyCode(code: number): PlanKey | null {
  return PLATFORM_PLANS.find((plan) => plan.legacyPlanCode === code)?.planKey ?? null;
}

/** Preço formatado em reais para exibição (o valor real é sempre centavos). */
export function formatPlanPrice(plan: PlatformPlan): string {
  return (plan.priceCents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 0,
  });
}

/** Próximo plano acima — usado pelas mensagens de upgrade da UI. */
export function nextPlanAbove(planKey: PlanKey): PlatformPlan | null {
  const current = getPlatformPlan(planKey);
  return PLATFORM_PLANS.find((plan) => plan.tier === current.tier + 1) ?? null;
}
