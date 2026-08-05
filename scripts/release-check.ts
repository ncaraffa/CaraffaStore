/**
 * Preflight de release — roda o máximo possível sem tocar em nenhuma
 * infraestrutura real (nenhum reset de banco, seed, migration destrutiva,
 * chamada Pix real ou deploy). Uso:
 *
 *   npm run release:check
 *
 * Cada etapa é reportada com PASS/FAIL. Exit code 1 se qualquer etapa
 * obrigatória falhar.
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");

type StepResult = { name: string; ok: boolean; detail: string };
const results: StepResult[] = [];

function record(name: string, ok: boolean, detail: string) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} — ${name}${detail ? `: ${detail}` : ""}`);
}

function runCommand(name: string, command: string) {
  try {
    execSync(command, { cwd: ROOT, stdio: "pipe" });
    record(name, true, "OK");
  } catch (error) {
    const output = error && typeof error === "object" && "stdout" in error ? String((error as { stdout: Buffer }).stdout) : "";
    record(name, false, output.split("\n").slice(-15).join(" | ") || String(error));
  }
}

// --- 1. Comandos padrão -----------------------------------------------

runCommand("typecheck", "npx tsc --noEmit");
runCommand("lint", "npm run lint");
runCommand("test", "npm test");
runCommand("build", "npm run build");
runCommand("audit", "npm audit --audit-level=low");

// --- 2. Arquivos obrigatórios -------------------------------------------

const REQUIRED_FILES = [
  ".env.example",
  ".env.production.example",
  "docs/production-runbook.md",
  "docs/release-checklist.md",
  "instrumentation.ts",
  "lib/env/production-env.ts",
  "lib/env/local-only-guard.ts",
  "scripts/production-db-verification.ts",
];
for (const file of REQUIRED_FILES) {
  record(`arquivo obrigatório: ${file}`, existsSync(path.join(ROOT, file)), existsSync(path.join(ROOT, file)) ? "presente" : "AUSENTE");
}

// --- 3. FakePixGateway nunca aceito em produção (checagem estática) -----

const gatewaySelectSource = readFileSync(path.join(ROOT, "lib/payments/gateway/select-mode.ts"), "utf8");
const gatewayGuardOk =
  gatewaySelectSource.includes('NODE_ENV === "production"') && gatewaySelectSource.includes("throw new Error");
record(
  "FakePixGateway bloqueado em produção (estático)",
  gatewayGuardOk,
  gatewayGuardOk ? "guard presente em lib/payments/gateway/select-mode.ts" : "guard não encontrado — investigar",
);

// --- 4. Scripts locais recusam produção (checagem estática) --------------

const seedSource = readFileSync(path.join(ROOT, "scripts/seed-local.ts"), "utf8");
const seedGuardOk = seedSource.includes("assertLocalOnlyScript(");
record(
  "seed-local.ts recusa produção (estático)",
  seedGuardOk,
  seedGuardOk ? "assertLocalOnlyScript() chamado" : "guard não encontrado — investigar",
);

// --- 5/6. Escopo: só arquivos rastreados pelo Git (exclui .env.local,
// supabase/.temp, node_modules etc. automaticamente — o que não está no
// Git não é enviado ao deploy) -------------------------------------------

const trackedFiles = execSync("git ls-files", { cwd: ROOT, encoding: "utf8" })
  .split("\n")
  .map((f) => f.trim())
  .filter(Boolean);

// --- 5. Nenhum host localhost hardcoded fora dos arquivos esperados -----

const LOCALHOST_ALLOWLIST = new Set([
  "lib/auth/site-url.ts", // fallback de dev documentado, validado em produção por lib/env/production-env.ts
  "lib/env/local-only-guard.ts", // barreira: precisa comparar contra "localhost"/"127.0.0.1" de propósito
  "lib/env/production-env.ts", // validação: precisa comparar contra "localhost"/"127.0.0.1" de propósito
  "lib/env/production-env.test.ts",
  "lib/env/local-only-guard.test.ts",
  "scripts/release-check.ts", // este próprio arquivo, cita os literais para o scan
  "scripts/production-db-verification.ts",
  ".env.example",
  ".env.production.example",
  "README.md",
]);
// Escopo: só código de app/lib que roda de fato em produção (app/, lib/,
// instrumentation.ts) — supabase/tests/**, scripts/** (exceto os listados
// acima), qa/** e docs/** são dev/QA-only e legitimamente referenciam
// localhost para rodar contra o Postgres local.
const localhostHits = trackedFiles.filter((relative) => {
  if (!/\.(ts|tsx)$/.test(relative)) return false;
  if (relative.endsWith(".test.ts") || relative.endsWith(".test.tsx")) return false;
  if (!(relative.startsWith("app/") || relative.startsWith("lib/") || relative === "instrumentation.ts")) return false;
  if (LOCALHOST_ALLOWLIST.has(relative)) return false;
  const full = path.join(ROOT, relative);
  if (!existsSync(full)) return false;
  const content = readFileSync(full, "utf8");
  return /127\.0\.0\.1|localhost/.test(content);
});
record(
  "sem localhost hardcoded fora da allowlist",
  localhostHits.length === 0,
  localhostHits.length === 0 ? "OK" : `encontrado em: ${localhostHits.join(", ")}`,
);

// --- 6. Scan de segredos no código-fonte rastreado (padrões óbvios) -----

const SECRET_PATTERNS = [/eyJhbGci[A-Za-z0-9_-]{20,}/, /sk_live_[A-Za-z0-9]+/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/];
const SECRET_SCAN_ALLOWLIST = new Set([
  // Fixture negativa deliberada (JWT falso) — prova que seed-output.ts
  // NUNCA imprime o valor real; ver scripts/seed-output.test.ts, caso 1.
  "scripts/seed-output.test.ts",
]);
const secretHits = trackedFiles.filter((relative) => {
  if (!/\.(ts|tsx|md|json)$/.test(relative)) return false;
  if (SECRET_SCAN_ALLOWLIST.has(relative)) return false;
  const full = path.join(ROOT, relative);
  if (!existsSync(full)) return false;
  const content = readFileSync(full, "utf8");
  return SECRET_PATTERNS.some((pattern) => pattern.test(content));
});
record("scan de segredos no código-fonte", secretHits.length === 0, secretHits.length === 0 ? "OK" : `encontrado em: ${secretHits.join(", ")}`);

// --- 7. Scan de segredos no bundle de produção (.next/static) -----------

const bundleDir = path.join(ROOT, ".next", "static");
if (existsSync(bundleDir)) {
  const bundleHits: string[] = [];
  function walkBundle(dir: string) {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        walkBundle(full);
        continue;
      }
      if (!/\.(js|css)$/.test(entry)) continue;
      const content = readFileSync(full, "utf8");
      if (
        content.includes("SUPABASE_SERVICE_ROLE_KEY") ||
        content.includes("PAYMENT_ENCRYPTION_KEY") ||
        content.includes("CRON_SECRET") ||
        SECRET_PATTERNS.some((pattern) => pattern.test(content))
      ) {
        bundleHits.push(path.relative(ROOT, full).replace(/\\/g, "/"));
      }
    }
  }
  walkBundle(bundleDir);
  record("scan de segredos no bundle (.next/static)", bundleHits.length === 0, bundleHits.length === 0 ? "OK" : `encontrado em: ${bundleHits.join(", ")}`);
} else {
  record("scan de segredos no bundle (.next/static)", false, "build não encontrado — rode após a etapa de build");
}

// --- Resultado final ------------------------------------------------------

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} etapas OK.`);
if (failed.length > 0) {
  console.log(`Falharam: ${failed.map((r) => r.name).join(", ")}`);
}
process.exitCode = failed.length === 0 ? 0 : 1;
