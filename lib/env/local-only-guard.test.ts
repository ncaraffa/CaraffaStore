import { afterEach, describe, expect, it } from "vitest";
import { assertLocalOnlyScript } from "./local-only-guard";

const ENV_KEYS = ["NODE_ENV", "NEXT_PUBLIC_SUPABASE_URL", "SEED_ALLOW_REMOTE_SUPABASE"] as const;
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

describe("assertLocalOnlyScript", () => {
  afterEach(restoreEnv);

  it("permite execução contra Supabase local (127.0.0.1)", () => {
    setNodeEnv("development");
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
    delete process.env.SEED_ALLOW_REMOTE_SUPABASE;
    expect(() => assertLocalOnlyScript("seed-local")).not.toThrow();
  });

  it("bloqueia incondicionalmente quando NODE_ENV=production, mesmo com host local", () => {
    setNodeEnv("production");
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
    expect(() => assertLocalOnlyScript("seed-local")).toThrowError(/NODE_ENV=production/);
  });

  it("bloqueia host remoto sem SEED_ALLOW_REMOTE_SUPABASE", () => {
    setNodeEnv("development");
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://my-project.supabase.co";
    delete process.env.SEED_ALLOW_REMOTE_SUPABASE;
    expect(() => assertLocalOnlyScript("seed-local")).toThrowError(/não aponta para um Supabase local/);
  });

  it("permite host remoto quando SEED_ALLOW_REMOTE_SUPABASE=true", () => {
    setNodeEnv("development");
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://my-project.supabase.co";
    process.env.SEED_ALLOW_REMOTE_SUPABASE = "true";
    expect(() => assertLocalOnlyScript("seed-local")).not.toThrow();
  });

  it("bloqueia quando NEXT_PUBLIC_SUPABASE_URL está ausente", () => {
    setNodeEnv("development");
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    expect(() => assertLocalOnlyScript("seed-local")).toThrowError(/ausente ou inválida/);
  });
});
