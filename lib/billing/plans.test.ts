import { describe, expect, it } from "vitest";
import { PLATFORM_PLANS, getPlatformPlan } from "./plans";

describe("PLATFORM_PLANS", () => {
  it("espelha exatamente platform_plan_price_cents (0008_saas_billing.sql): 30->R$30, 50->R$50, 80->R$70", () => {
    expect(getPlatformPlan(30)).toMatchObject({ code: 30, label: "Essencial", price: 30 });
    expect(getPlatformPlan(50)).toMatchObject({ code: 50, label: "Crescimento", price: 50 });
    expect(getPlatformPlan(80)).toMatchObject({ code: 80, label: "Profissional", price: 70 });
  });

  it("Profissional mantém o identificador técnico legado plan_code=80 mesmo custando R$70 (docs/PLANS-SPEC.md)", () => {
    const profissional = getPlatformPlan(80);
    expect(profissional.code).toBe(80);
    expect(profissional.price).not.toBe(80);
  });

  it("só existem os três planos oficiais, cada um com code único", () => {
    expect(PLATFORM_PLANS).toHaveLength(3);
    expect(new Set(PLATFORM_PLANS.map((p) => p.code)).size).toBe(3);
  });
});
