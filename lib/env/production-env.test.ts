import { afterEach, describe, expect, it } from "vitest";
import { assertProductionEnv } from "./production-env";

const ENV_KEYS = [
  "NODE_ENV",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "NEXT_PUBLIC_SITE_URL",
  "PAYMENT_ENCRYPTION_KEY",
  "CRON_SECRET",
  "PAYMENT_GATEWAY_MODE",
] as const;

const original: Record<string, string | undefined> = {};
for (const key of ENV_KEYS) original[key] = process.env[key];

// `next/types` declara `NODE_ENV` como readonly — cast pontual necessário
// para simular o valor real em teste (mesmo padrão de lib/env/load-local-env.test.ts).
function setNodeEnv(value: string): void {
  (process.env as { NODE_ENV: string }).NODE_ENV = value;
}

function restoreEnv() {
  for (const key of ENV_KEYS) {
    if (key === "NODE_ENV") {
      if (original.NODE_ENV !== undefined) setNodeEnv(original.NODE_ENV);
      continue;
    }
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
}

function setValidProductionEnv() {
  setNodeEnv("production");
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
  process.env.NEXT_PUBLIC_SITE_URL = "https://loja.example.com";
  process.env.PAYMENT_ENCRYPTION_KEY = "base64-key";
  process.env.CRON_SECRET = "cron-secret";
  delete process.env.PAYMENT_GATEWAY_MODE;
}

describe("assertProductionEnv", () => {
  afterEach(restoreEnv);

  it("não faz nada fora de produção, mesmo sem nenhuma variável definida", () => {
    setNodeEnv("test");
    for (const key of ENV_KEYS) {
      if (key !== "NODE_ENV") delete process.env[key];
    }
    expect(() => assertProductionEnv()).not.toThrow();
  });

  it("passa em produção quando todas as variáveis são válidas", () => {
    setValidProductionEnv();
    expect(() => assertProductionEnv()).not.toThrow();
  });

  it("falha citando o nome da variável ausente, nunca o valor", () => {
    setValidProductionEnv();
    delete process.env.CRON_SECRET;
    expect(() => assertProductionEnv()).toThrowError(/CRON_SECRET/);
  });

  it("rejeita NEXT_PUBLIC_SITE_URL apontando para localhost", () => {
    setValidProductionEnv();
    process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";
    expect(() => assertProductionEnv()).toThrowError(/NEXT_PUBLIC_SITE_URL/);
  });

  it("rejeita NEXT_PUBLIC_SITE_URL sem https", () => {
    setValidProductionEnv();
    process.env.NEXT_PUBLIC_SITE_URL = "http://loja.example.com";
    expect(() => assertProductionEnv()).toThrowError(/NEXT_PUBLIC_SITE_URL/);
  });

  it("rejeita NEXT_PUBLIC_SUPABASE_URL apontando para 127.0.0.1", () => {
    setValidProductionEnv();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
    expect(() => assertProductionEnv()).toThrowError(/NEXT_PUBLIC_SUPABASE_URL/);
  });

  it("rejeita PAYMENT_GATEWAY_MODE=fake em produção", () => {
    setValidProductionEnv();
    process.env.PAYMENT_GATEWAY_MODE = "fake";
    expect(() => assertProductionEnv()).toThrowError(/PAYMENT_GATEWAY_MODE/);
  });

  it("nunca inclui o valor da variável inválida na mensagem de erro", () => {
    setValidProductionEnv();
    process.env.NEXT_PUBLIC_SITE_URL = "http://a-secret-looking-host.internal:9999";
    try {
      assertProductionEnv();
      throw new Error("deveria ter lançado");
    } catch (error) {
      expect(String(error)).not.toContain("a-secret-looking-host");
    }
  });
});
