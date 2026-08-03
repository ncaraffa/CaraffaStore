import { afterEach, describe, expect, it } from "vitest";
import { getPublicSupabaseEnv, getServiceRoleEnv } from "./env";

/**
 * FINAL-BUG-001 (qa/reports/TASK-001-RETEST-2.md) exige que, quando uma
 * variável obrigatória estiver ausente, o erro cite somente o NOME da
 * variável — nunca um valor, mesmo que inválido. Estes testes cobrem
 * exatamente essa garantia.
 */

const ENV_KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

const original = new Map<string, string | undefined>();

function snapshotEnv() {
  for (const key of ENV_KEYS) original.set(key, process.env[key]);
}

function restoreEnv() {
  for (const key of ENV_KEYS) {
    const value = original.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function captureError(fn: () => unknown): Error {
  try {
    fn();
  } catch (error) {
    return error as Error;
  }
  throw new Error("esperava que a função lançasse um erro, mas não lançou");
}

describe("getPublicSupabaseEnv / getServiceRoleEnv — erro sanitizado (4 e 5)", () => {
  afterEach(() => {
    restoreEnv();
  });

  it("4. variável obrigatória ausente gera erro claro citando o nome dela", () => {
    snapshotEnv();
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key-de-teste";

    const error = captureError(() => getPublicSupabaseEnv());

    expect(error.message).toContain("NEXT_PUBLIC_SUPABASE_URL");
  });

  it("4. SUPABASE_SERVICE_ROLE_KEY ausente gera erro claro citando o nome dela", () => {
    snapshotEnv();
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    const error = captureError(() => getServiceRoleEnv());

    expect(error.message).toContain("SUPABASE_SERVICE_ROLE_KEY");
  });

  it("5. nenhum valor (mesmo inválido) aparece na mensagem de erro", () => {
    snapshotEnv();
    const segredoDeTeste = "nao-e-url-mas-parece-um-segredo-de-teste-xyz789";
    process.env.NEXT_PUBLIC_SUPABASE_URL = segredoDeTeste;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "outro-valor-secreto-de-teste";

    const error = captureError(() => getPublicSupabaseEnv());

    expect(error.message).not.toContain(segredoDeTeste);
    expect(error.message).not.toContain("outro-valor-secreto-de-teste");
    expect(error.message).toContain("NEXT_PUBLIC_SUPABASE_URL");
  });

  it("com todas as variáveis válidas, retorna os valores sem lançar", () => {
    snapshotEnv();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key-de-teste";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key-de-teste";

    expect(getPublicSupabaseEnv()).toEqual({
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key-de-teste",
    });
    expect(getServiceRoleEnv()).toEqual({
      SUPABASE_SERVICE_ROLE_KEY: "service-role-key-de-teste",
    });
  });
});
