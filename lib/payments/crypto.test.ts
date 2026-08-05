import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guarda de regressão por análise estática para a fronteira server-only
 * de lib/payments/crypto.ts — mesmo padrão de
 * lib/supabase/service-only/recovery-completion.test.ts. O comportamento
 * real do algoritmo é coberto por lib/payments/crypto-core.test.ts (esse
 * módulo não tem `server-only`, então pode ser importado em runtime de
 * teste); aqui só garantimos que a barreira em si está no lugar certo.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const CRYPTO_PATH = path.join(ROOT, "lib", "payments", "crypto.ts");

function collectTsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      collectTsFiles(full, out);
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe("lib/payments/crypto.ts — fronteira server-only", () => {
  it('começa com import "server-only"', () => {
    const source = readFileSync(CRYPTO_PATH, "utf8");
    expect(source.trimStart().startsWith('import "server-only";')).toBe(true);
  });

  it("nunca descriptografa/criptografa sem passar pela chave do ambiente (sem valor hardcoded)", () => {
    const source = readFileSync(CRYPTO_PATH, "utf8");
    expect(source).not.toMatch(/PAYMENT_ENCRYPTION_KEY\s*=\s*["'`]/);
    expect(source).toContain("process.env.PAYMENT_ENCRYPTION_KEY");
  });

  it("app/ e lib/ não têm nenhuma variável de ambiente de pagamento com prefixo NEXT_PUBLIC_", () => {
    const files = [...collectTsFiles(path.join(ROOT, "app")), ...collectTsFiles(path.join(ROOT, "lib"))];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      expect(source, `${file} não deve referenciar NEXT_PUBLIC_PAYMENT_ENCRYPTION_KEY`).not.toMatch(
        /NEXT_PUBLIC_PAYMENT_ENCRYPTION_KEY/,
      );
      expect(source, `${file} não deve referenciar NEXT_PUBLIC_.*ACCESS_TOKEN`).not.toMatch(
        /NEXT_PUBLIC_[A-Z_]*ACCESS_TOKEN/,
      );
    }
  });
});
