import { describe, expect, it } from "vitest";
import { furthestIncompleteStep, resolveOnboardingView } from "./steps";
import type { Database } from "@/lib/supabase/types";

type OnboardingRow = Database["public"]["Tables"]["onboarding_progress"]["Row"];

function progress(overrides: Partial<OnboardingRow> = {}): OnboardingRow {
  return {
    user_id: "u1",
    step: "profile",
    merchant_name: null,
    whatsapp: null,
    store_name: null,
    slug: null,
    plan_code: null,
    completed_at: null,
    created_at: "2026-08-03T00:00:00.000Z",
    updated_at: "2026-08-03T00:00:00.000Z",
    ...overrides,
  };
}

describe("furthestIncompleteStep", () => {
  it("profile quando nada foi preenchido", () => {
    expect(furthestIncompleteStep(progress())).toBe("profile");
  });

  it("profile quando só merchant_name está preenchido (whatsapp também é exigido)", () => {
    expect(furthestIncompleteStep(progress({ merchant_name: "Fulano" }))).toBe("profile");
  });

  it("store_name quando profile completo", () => {
    expect(
      furthestIncompleteStep(progress({ merchant_name: "Fulano", whatsapp: "+5511999998888" })),
    ).toBe("store_name");
  });

  it("slug quando profile + nome da loja completos", () => {
    expect(
      furthestIncompleteStep(
        progress({ merchant_name: "Fulano", whatsapp: "+5511999998888", store_name: "Loja" }),
      ),
    ).toBe("slug");
  });

  it("plan quando falta só o plano", () => {
    expect(
      furthestIncompleteStep(
        progress({
          merchant_name: "Fulano",
          whatsapp: "+5511999998888",
          store_name: "Loja",
          slug: "loja",
        }),
      ),
    ).toBe("plan");
  });

  it("review quando tudo preenchido", () => {
    expect(
      furthestIncompleteStep(
        progress({
          merchant_name: "Fulano",
          whatsapp: "+5511999998888",
          store_name: "Loja",
          slug: "loja",
          plan_code: 50,
        }),
      ),
    ).toBe("review");
  });
});

describe("resolveOnboardingView", () => {
  const fullyFilled = progress({
    merchant_name: "Fulano",
    whatsapp: "+5511999998888",
    store_name: "Loja",
    slug: "loja",
    plan_code: 50,
  });

  it("sem ?step=, mostra o primeiro passo incompleto", () => {
    expect(resolveOnboardingView(progress())).toBe("profile");
    expect(resolveOnboardingView(fullyFilled)).toBe("review");
  });

  it("permite voltar para um passo já alcançado (editar slug já preenchido)", () => {
    expect(resolveOnboardingView(fullyFilled, "slug")).toBe("slug");
    expect(resolveOnboardingView(fullyFilled, "profile")).toBe("profile");
  });

  it("NUNCA permite pular à frente do primeiro passo incompleto", () => {
    const onlyProfileDone = progress({ merchant_name: "Fulano", whatsapp: "+5511999998888" });
    // furthest incomplete é "store_name" — tentar pedir "plan" ou "review" direto é ignorado.
    expect(resolveOnboardingView(onlyProfileDone, "plan")).toBe("store_name");
    expect(resolveOnboardingView(onlyProfileDone, "review")).toBe("store_name");
    expect(resolveOnboardingView(onlyProfileDone, "slug")).toBe("store_name");
  });

  it("ignora um ?step= com valor desconhecido/forjado", () => {
    expect(resolveOnboardingView(fullyFilled, "nao-existe")).toBe("review");
    expect(resolveOnboardingView(fullyFilled, "")).toBe("review");
  });

  it("null/undefined equivalem a não informar o parâmetro", () => {
    expect(resolveOnboardingView(fullyFilled, null)).toBe("review");
    expect(resolveOnboardingView(fullyFilled, undefined)).toBe("review");
  });
});
