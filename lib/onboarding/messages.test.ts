import { describe, expect, it } from "vitest";
import { FIELD_LEVEL_CODES, messageForOnboardingError, onboardingErrorMessage } from "./messages";
import { OnboardingError } from "./service";

describe("onboardingErrorMessage", () => {
  it("mapeia todos os códigos de erro conhecidos das funções SQL para texto em PT-BR", () => {
    const knownCodes = [
      "auth_required",
      "email_not_verified",
      "already_has_store",
      "onboarding_not_started",
      "onboarding_already_completed",
      "invalid_merchant_name",
      "invalid_whatsapp",
      "profile_required",
      "invalid_store_name",
      "store_name_required",
      "invalid_slug",
      "reserved_slug",
      "slug_taken",
      "invalid_plan",
      "slug_required",
      "onboarding_incomplete",
    ];
    for (const code of knownCodes) {
      const message = onboardingErrorMessage(code);
      expect(message.length).toBeGreaterThan(0);
      // Nunca devolve o código cru como mensagem — sempre um texto real.
      expect(message).not.toBe(code);
    }
  });

  it("devolve uma mensagem genérica para um código desconhecido, sem lançar", () => {
    expect(() => onboardingErrorMessage("codigo_nunca_visto")).not.toThrow();
    expect(onboardingErrorMessage("codigo_nunca_visto").length).toBeGreaterThan(0);
  });
});

describe("messageForOnboardingError", () => {
  it("usa o código de um OnboardingError real", () => {
    expect(messageForOnboardingError(new OnboardingError("slug_taken"))).toBe(
      onboardingErrorMessage("slug_taken"),
    );
  });

  it("cai na mensagem genérica para qualquer outro tipo de erro", () => {
    expect(messageForOnboardingError(new Error("erro qualquer"))).toBe(
      "Não foi possível concluir. Tente novamente.",
    );
    expect(messageForOnboardingError("string solta")).toBe("Não foi possível concluir. Tente novamente.");
    expect(messageForOnboardingError(null)).toBe("Não foi possível concluir. Tente novamente.");
  });
});

describe("FIELD_LEVEL_CODES", () => {
  it("contém só os códigos que fazem sentido como erro de campo específico", () => {
    expect(FIELD_LEVEL_CODES.has("slug_taken")).toBe(true);
    expect(FIELD_LEVEL_CODES.has("reserved_slug")).toBe(true);
    expect(FIELD_LEVEL_CODES.has("invalid_plan")).toBe(true);
    // Erros de fluxo/sessão não são erro de campo.
    expect(FIELD_LEVEL_CODES.has("auth_required")).toBe(false);
    expect(FIELD_LEVEL_CODES.has("already_has_store")).toBe(false);
    expect(FIELD_LEVEL_CODES.has("onboarding_incomplete")).toBe(false);
  });
});
