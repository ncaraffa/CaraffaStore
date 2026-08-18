import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

// Estes testes varrem app/, lib/, scripts/ e supabase/ no disco de forma
// síncrona: o custo cresce com o repositório, e sob execução paralela
// passaram a estourar o limite padrão de 5s (TASK-012 acrescentou
// arquivos). O que eles verificam é uma FRONTEIRA DE SEGURANÇA, não
// desempenho — dar folga aqui preserva a intenção; baixar o rigor da
// varredura, não.
vi.setConfig({ testTimeout: 30_000 });

/**
 * Guarda de regressão por análise estática para a fronteira server-only
 * do módulo de emissão do grant de recuperação (revisão externa sobre
 * qa/reports/TASK-002-CLAUDE-VERIFICATION-2.md, Ponto 1). Cobre:
 *
 *   - `import "server-only"` presente como a primeira importação — faz
 *     o BUILD falhar (não só uma exceção em runtime) se este módulo
 *     algum dia for alcançado pelo grafo de imports de um Client
 *     Component.
 *   - Nenhum outro arquivo em app/ ou lib/, além da única rota legítima
 *     (app/auth/recovery/route.ts), importa este módulo.
 *   - Nenhuma variável de ambiente relacionada a service_role usa o
 *     prefixo NEXT_PUBLIC_ (que faria o Next.js inliná-la em bundles
 *     cliente).
 *
 * A ausência do valor real da chave em `.next/static`/`.next/server`
 * após `npm run build` foi verificada manualmente nesta sessão (não é
 * prática nem rápida como teste automatizado de `npm test`, que não
 * depende de build prévio) — ver qa/reports/TASK-002-CLAUDE-VERIFICATION-3.md.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const ISSUER_PATH = path.join(ROOT, "lib", "supabase", "service-only", "recovery-grant-issuer.ts");
const ALLOWED_IMPORTERS = new Set([path.join(ROOT, "app", "auth", "recovery", "route.ts")]);

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

describe("lib/supabase/service-only/recovery-grant-issuer.ts — fronteira server-only", () => {
  const source = readFileSync(ISSUER_PATH, "utf8");

  it('contém `import "server-only";` como a primeira importação do arquivo', () => {
    const firstImportLine = source
      .split("\n")
      .find((line) => line.trim().startsWith("import "));
    expect(firstImportLine?.trim()).toBe('import "server-only";');
  });

  it("nenhum arquivo em app/ ou lib/, além de app/auth/recovery/route.ts, importa recovery-grant-issuer", () => {
    const files: string[] = [];
    for (const dir of ["app", "lib"]) {
      collectTsFiles(path.join(ROOT, dir), files);
    }

    const offenders: string[] = [];
    for (const file of files) {
      if (file === ISSUER_PATH) continue;
      if (ALLOWED_IMPORTERS.has(file)) continue;
      const content = readFileSync(file, "utf8");
      if (content.includes("service-only/recovery-grant-issuer")) {
        offenders.push(path.relative(ROOT, file));
      }
    }

    expect(offenders).toEqual([]);
  });

  it("nenhuma variável de ambiente SUPABASE_SERVICE_ROLE_KEY (ou equivalente) usa prefixo NEXT_PUBLIC_ em nenhum arquivo do projeto", () => {
    const files: string[] = [];
    for (const dir of ["app", "lib", "scripts", "supabase"]) {
      const full = path.join(ROOT, dir);
      try {
        collectTsFiles(full, files);
      } catch {
        // diretório pode não existir (ex.: supabase/ tem .sql, não .ts) — ignora
      }
    }
    const offenders: string[] = [];
    for (const file of files) {
      const content = readFileSync(file, "utf8");
      if (/NEXT_PUBLIC_[A-Z_]*SERVICE_ROLE/.test(content)) {
        offenders.push(path.relative(ROOT, file));
      }
    }
    expect(offenders).toEqual([]);
  });
});
