import { describe, expect, it } from "vitest";
import { isNearLimit, quotaKindForErrorCode, quotaNotice } from "./quota-messages";

describe("quotaNotice — produtos", () => {
  it("Essencial cita o limite real e o ganho concreto do Crescimento", () => {
    const notice = quotaNotice("products", "essential");
    expect(notice.title).toBe("Você chegou ao limite de 75 produtos.");
    expect(notice.body).toContain("Essencial permite até 75");
    expect(notice.body).toContain("Crescimento");
    expect(notice.body).toContain("350");
    expect(notice.upgradeTo?.planKey).toBe("growth");
  });

  it("Crescimento aponta para o Profissional com o número dele", () => {
    const notice = quotaNotice("products", "growth");
    expect(notice.title).toContain("350");
    expect(notice.body).toContain("1.000");
    expect(notice.upgradeTo?.planKey).toBe("professional");
  });

  it("Profissional não oferece upgrade — não existe plano acima", () => {
    const notice = quotaNotice("products", "professional");
    expect(notice.title).toContain("1.000");
    expect(notice.upgradeTo).toBeUndefined();
    expect(notice.body).not.toContain("No ");
  });
});

describe("quotaNotice — imagens", () => {
  it("Essencial usa singular (1 foto), não '1 fotos'", () => {
    const notice = quotaNotice("images", "essential");
    expect(notice.title).toBe("O Essencial permite 1 foto por produto.");
    expect(notice.body).toContain("já possui a foto permitida");
    expect(notice.body).toContain("até 5 fotos");
  });

  it("Crescimento usa plural e aponta as 10 do Profissional", () => {
    const notice = quotaNotice("images", "growth");
    expect(notice.title).toContain("5 fotos");
    expect(notice.body).toContain("10 fotos");
  });
});

describe("quotaNotice — lojas", () => {
  /**
   * Essencial e Crescimento têm o MESMO limite de 1 loja. Sugerir
   * "vá para o Crescimento para ter mais lojas" seria falso — o
   * upgrade oferecido tem que ser o primeiro que realmente aumenta o
   * limite.
   */
  it("Essencial é mandado direto ao Profissional, não ao Crescimento", () => {
    const notice = quotaNotice("stores", "essential");
    expect(notice.body).toContain("Profissional");
    expect(notice.body).toContain("até 3 lojas");
    expect(notice.upgradeTo?.planKey).toBe("professional");
  });

  it("Crescimento também é mandado ao Profissional", () => {
    const notice = quotaNotice("stores", "growth");
    expect(notice.upgradeTo?.planKey).toBe("professional");
  });

  it("Profissional não recebe oferta de upgrade de lojas", () => {
    const notice = quotaNotice("stores", "professional");
    expect(notice.upgradeTo).toBeUndefined();
  });
});

describe("quotaNotice — equipe e cupons", () => {
  it("Essencial explica que equipe começa no Crescimento", () => {
    const notice = quotaNotice("team", "essential");
    expect(notice.title).toBe("Seu plano permite 1 usuário.");
    expect(notice.body).toContain("Crescimento");
  });

  it("cupons citam os dois planos que os têm", () => {
    const notice = quotaNotice("coupons", "essential");
    expect(notice.title).toContain("Crescimento");
    expect(notice.title).toContain("Profissional");
  });
});

describe("quotaKindForErrorCode", () => {
  it("mapeia os códigos que o banco levanta", () => {
    expect(quotaKindForErrorCode("max_products_reached")).toBe("products");
    expect(quotaKindForErrorCode("max_images_reached")).toBe("images");
    expect(quotaKindForErrorCode("max_stores_reached")).toBe("stores");
  });

  it("devolve null para erro que não é de quota — não vira mensagem de upgrade", () => {
    expect(quotaKindForErrorCode("insufficient_privilege")).toBeNull();
    expect(quotaKindForErrorCode("slug_taken")).toBeNull();
  });
});

describe("isNearLimit", () => {
  it("sinaliza a partir de 80% e para de sinalizar no limite (aí é bloqueio, não aviso)", () => {
    expect(isNearLimit(59, 75)).toBe(false);
    expect(isNearLimit(60, 75)).toBe(true);
    expect(isNearLimit(74, 75)).toBe(true);
    expect(isNearLimit(75, 75)).toBe(false);
  });

  it("não sinaliza com limite zero/negativo", () => {
    expect(isNearLimit(0, 0)).toBe(false);
  });
});
