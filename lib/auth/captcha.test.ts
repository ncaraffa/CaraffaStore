import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyCaptcha } from "./captcha";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("verifyCaptcha", () => {
  it("sempre válido quando CAPTCHA_ENABLED não é 'true' (padrão do dev local)", async () => {
    delete process.env.CAPTCHA_ENABLED;
    const result = await verifyCaptcha("qualquer-token");
    expect(result).toEqual({ valid: true });
  });

  it("sempre válido mesmo sem token quando desativado", async () => {
    process.env.CAPTCHA_ENABLED = "false";
    const result = await verifyCaptcha(null);
    expect(result.valid).toBe(true);
  });

  it("rejeita quando ativado e nenhum token é enviado", async () => {
    process.env.CAPTCHA_ENABLED = "true";
    process.env.CAPTCHA_SECRET_KEY = "secret";
    const result = await verifyCaptcha(null);
    expect(result).toEqual({ valid: false, reason: "missing_token" });
  });

  it("rejeita quando ativado sem CAPTCHA_SECRET_KEY configurado", async () => {
    process.env.CAPTCHA_ENABLED = "true";
    delete process.env.CAPTCHA_SECRET_KEY;
    const result = await verifyCaptcha("token");
    expect(result).toEqual({ valid: false, reason: "captcha_not_configured" });
  });

  it("chama o endpoint do provedor e aceita quando success=true, sem vazar o secret na chamada de teste", async () => {
    process.env.CAPTCHA_ENABLED = "true";
    process.env.CAPTCHA_SECRET_KEY = "super-secret-value";
    process.env.CAPTCHA_PROVIDER = "hcaptcha";

    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      expect(String(url)).toContain("hcaptcha.com/siteverify");
      expect(String(init?.body)).toContain("response=user-token");
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    });

    const result = await verifyCaptcha("user-token", { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result).toEqual({ valid: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("usa o endpoint do turnstile quando CAPTCHA_PROVIDER=turnstile", async () => {
    process.env.CAPTCHA_ENABLED = "true";
    process.env.CAPTCHA_SECRET_KEY = "secret";
    process.env.CAPTCHA_PROVIDER = "turnstile";

    const fetchImpl = vi.fn(async (url: string | URL) => {
      expect(String(url)).toContain("challenges.cloudflare.com/turnstile");
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    });

    await verifyCaptcha("token", { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejeita quando o provedor responde success=false", async () => {
    process.env.CAPTCHA_ENABLED = "true";
    process.env.CAPTCHA_SECRET_KEY = "secret";
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ success: false }), { status: 200 }));
    const result = await verifyCaptcha("token", { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result).toEqual({ valid: false, reason: "rejected" });
  });

  it("rejeita quando a chamada ao provedor falha (rede/HTTP)", async () => {
    process.env.CAPTCHA_ENABLED = "true";
    process.env.CAPTCHA_SECRET_KEY = "secret";
    const fetchImpl = vi.fn(async () => new Response("boom", { status: 500 }));
    const result = await verifyCaptcha("token", { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result).toEqual({ valid: false, reason: "verification_request_failed" });
  });

  it("rejeita quando o fetch lança (offline)", async () => {
    process.env.CAPTCHA_ENABLED = "true";
    process.env.CAPTCHA_SECRET_KEY = "secret";
    const fetchImpl = vi.fn(async () => {
      throw new Error("network down");
    });
    const result = await verifyCaptcha("token", { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result).toEqual({ valid: false, reason: "verification_request_failed" });
  });
});
