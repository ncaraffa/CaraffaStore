import type { PlanCode } from "@/lib/supabase/types";

export interface PlatformPlan {
  code: PlanCode;
  label: string;
  price: number;
  tier: number;
  featured: boolean;
}

/**
 * Única fonte de verdade no lado da aplicação para o catálogo comercial
 * de planos — espelha exatamente `platform_plan_price_cents`
 * (supabase/migrations/0008_saas_billing.sql): Essencial R$30,
 * Crescimento R$50, Profissional R$70 sob o identificador técnico legado
 * `plan_code=80` (docs/PLANS-SPEC.md — nunca renomear para 70 sem
 * migration própria). `app/onboarding/plan-step.tsx` e a tela de
 * pending-payment importam esta lista em vez de duplicá-la. O valor
 * cobrado de verdade nunca vem daqui: é sempre
 * `platform_plan_price_cents(plan_code)` no banco, no momento da criação
 * da cobrança — esta lista é só para exibição.
 */
export const PLATFORM_PLANS: readonly PlatformPlan[] = [
  { code: 30, label: "Essencial", price: 30, tier: 1, featured: false },
  { code: 50, label: "Crescimento", price: 50, tier: 2, featured: true },
  { code: 80, label: "Profissional", price: 70, tier: 3, featured: false },
];

export function getPlatformPlan(code: PlanCode): PlatformPlan {
  const plan = PLATFORM_PLANS.find((candidate) => candidate.code === code);
  if (!plan) {
    throw new Error(`unknown_plan_code:${code}`);
  }
  return plan;
}
