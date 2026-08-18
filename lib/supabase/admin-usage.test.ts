import { readdirSync, readFileSync, statSync } from "node:fs";
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
 * Guarda de regressão estática para o BUG-T2-004 (qa/reports/TASK-002.md):
 * `createAdminSupabaseClient`/service role nunca pode ser importado por
 * código que responde a requisição de usuário (Server Actions, Route
 * Handlers, middleware/proxy, páginas). Só é permitido em scripts de
 * seed/manutenção e nos próprios testes reais contra Supabase local.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const FORBIDDEN_DIRS = ["app", "lib", "proxy.ts"];
const ALLOWED_FILES = new Set([
  path.join(ROOT, "lib", "supabase", "admin.ts"), // a própria fábrica do cliente
]);

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

describe("service role nunca em código de fluxo de usuário (BUG-T2-004)", () => {
  it("nenhum arquivo em app/ ou lib/ (fora de lib/supabase/admin.ts) importa createAdminSupabaseClient", () => {
    const files: string[] = [];
    for (const target of FORBIDDEN_DIRS) {
      const full = path.join(ROOT, target);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        collectTsFiles(full, files);
      } else {
        files.push(full);
      }
    }

    const offenders: string[] = [];
    for (const file of files) {
      if (ALLOWED_FILES.has(file)) continue;
      const content = readFileSync(file, "utf8");
      if (content.includes("createAdminSupabaseClient") || content.includes("lib/supabase/admin")) {
        offenders.push(path.relative(ROOT, file));
      }
    }

    expect(offenders).toEqual([]);
  });
});
