import { beforeEach, describe, expect, it } from "vitest";
import { __clearAllRateLimits, checkRateLimit, resetRateLimit } from "./rate-limit";

beforeEach(() => {
  __clearAllRateLimits();
});

describe("checkRateLimit", () => {
  it("permite até o limite configurado dentro da janela", () => {
    const key = "1.2.3.4";
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit(key, "signup", 1000).allowed).toBe(true);
    }
  });

  it("bloqueia após exceder o limite dentro da mesma janela", () => {
    const key = "1.2.3.4";
    for (let i = 0; i < 5; i++) {
      checkRateLimit(key, "signup", 1000);
    }
    const blocked = checkRateLimit(key, "signup", 1500);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it("libera de novo após a janela expirar", () => {
    const key = "1.2.3.4";
    for (let i = 0; i < 5; i++) {
      checkRateLimit(key, "signup", 1000);
    }
    expect(checkRateLimit(key, "signup", 1000).allowed).toBe(false);
    const afterWindow = checkRateLimit(key, "signup", 1000 + 5 * 60_000 + 1);
    expect(afterWindow.allowed).toBe(true);
  });

  it("mantém contadores independentes por ação", () => {
    const key = "5.6.7.8";
    for (let i = 0; i < 10; i++) {
      checkRateLimit(key, "login", 1000);
    }
    expect(checkRateLimit(key, "login", 1000).allowed).toBe(false);
    expect(checkRateLimit(key, "signup", 1000).allowed).toBe(true);
  });

  it("mantém contadores independentes por chave (IP)", () => {
    for (let i = 0; i < 5; i++) {
      checkRateLimit("ip-a", "signup", 1000);
    }
    expect(checkRateLimit("ip-a", "signup", 1000).allowed).toBe(false);
    expect(checkRateLimit("ip-b", "signup", 1000).allowed).toBe(true);
  });

  it("resetRateLimit limpa o contador de uma chave/ação específica", () => {
    const key = "9.9.9.9";
    for (let i = 0; i < 5; i++) {
      checkRateLimit(key, "signup", 1000);
    }
    expect(checkRateLimit(key, "signup", 1000).allowed).toBe(false);
    resetRateLimit(key, "signup");
    expect(checkRateLimit(key, "signup", 1000).allowed).toBe(true);
  });

  it("reenvio de verificação tem janela curta e limite de 1 por minuto", () => {
    const key = "resend-1";
    expect(checkRateLimit(key, "resend_verification", 1000).allowed).toBe(true);
    expect(checkRateLimit(key, "resend_verification", 1000).allowed).toBe(false);
    expect(checkRateLimit(key, "resend_verification", 1000 + 60_000 + 1).allowed).toBe(true);
  });
});
