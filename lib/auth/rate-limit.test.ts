import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __clearAllRateLimits,
  buildRateLimitKey,
  checkRateLimit,
  resetRateLimit,
} from "./rate-limit";

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

describe("buildRateLimitKey", () => {
  it("usuário autenticado usa a própria identidade, ignora e-mail/ip", () => {
    const key = buildRateLimitKey({ action: "resend_verification", userId: "user-1", ip: "1.2.3.4" });
    expect(key).toBe("user:user-1");
  });

  it("sem usuário, combina hash do e-mail com o ip", () => {
    const key = buildRateLimitKey({ action: "signup", ip: "1.2.3.4", email: "fulano@example.test" });
    expect(key).toMatch(/^email:[0-9a-f]{32}\|ip:1\.2\.3\.4$/);
    expect(key).not.toContain("fulano");
    expect(key).not.toContain("example.test");
  });

  it("mesmo e-mail com capitalização/espaços diferentes gera a mesma chave", () => {
    const a = buildRateLimitKey({ action: "signup", ip: "1.2.3.4", email: "Fulano@Example.TEST" });
    const b = buildRateLimitKey({ action: "signup", ip: "1.2.3.4", email: "  fulano@example.test  " });
    expect(a).toBe(b);
  });

  it("sem e-mail nem usuário, usa só o ip", () => {
    const key = buildRateLimitKey({ action: "signup", ip: "1.2.3.4" });
    expect(key).toBe("email:none|ip:1.2.3.4");
  });

  it("e-mails diferentes com o mesmo ip geram chaves diferentes (limite por alvo, não só por origem)", () => {
    const a = buildRateLimitKey({ action: "password_recovery", ip: "1.2.3.4", email: "a@example.test" });
    const b = buildRateLimitKey({ action: "password_recovery", ip: "1.2.3.4", email: "b@example.test" });
    expect(a).not.toBe(b);
  });
});

describe("getClientIp — modo sem trusted proxy (padrão)", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    delete process.env.TRUSTED_PROXY_ENABLED;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.doUnmock("next/headers");
  });

  it("ignora x-forwarded-for forjado quando TRUSTED_PROXY_ENABLED não está ligado — não permite bypass do limite por IP", async () => {
    vi.doMock("next/headers", () => ({
      headers: async () =>
        new Map([
          ["x-forwarded-for", "203.0.113.99"],
          ["x-real-ip", "203.0.113.99"],
        ]) as unknown as Headers,
    }));

    const { getClientIp: freshGetClientIp } = await import("./rate-limit");
    const ip1 = await freshGetClientIp();

    vi.doMock("next/headers", () => ({
      headers: async () =>
        new Map([
          ["x-forwarded-for", "198.51.100.1"],
          ["x-real-ip", "198.51.100.1"],
        ]) as unknown as Headers,
    }));
    vi.resetModules();
    const { getClientIp: freshGetClientIp2 } = await import("./rate-limit");
    const ip2 = await freshGetClientIp2();

    // Dois valores de x-forwarded-for completamente diferentes (como um
    // atacante forjaria a cada tentativa para escapar do limite) devem
    // resolver para a MESMA chave "untrusted-origin" — prova que o
    // header do cliente não influencia a identidade usada pelo limiter
    // quando não há proxy confiável configurado (BUG-T2-005).
    expect(ip1).toBe("untrusted-origin");
    expect(ip2).toBe("untrusted-origin");
    expect(ip1).toBe(ip2);
  });
});

describe("getClientIp — modo com trusted proxy explicitamente ativado", () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.doUnmock("next/headers");
    vi.resetModules();
  });

  it("usa x-forwarded-for só quando TRUSTED_PROXY_ENABLED=true", async () => {
    process.env.TRUSTED_PROXY_ENABLED = "true";
    vi.doMock("next/headers", () => ({
      headers: async () => new Map([["x-forwarded-for", "203.0.113.5, 10.0.0.1"]]) as unknown as Headers,
    }));
    vi.resetModules();

    const { getClientIp: freshGetClientIp } = await import("./rate-limit");
    expect(await freshGetClientIp()).toBe("203.0.113.5");
  });
});
