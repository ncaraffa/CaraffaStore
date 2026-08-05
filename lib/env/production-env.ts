/**
 * Validação adicional exigida SOMENTE quando NODE_ENV=production. Fora de
 * produção (dev/test/CI) esta função não faz nada — a validação básica de
 * presença já é feita por lib/supabase/env.ts (usada em todo ambiente).
 *
 * Objetivo: falhar rápido e cedo (no boot do processo, via
 * instrumentation.ts) com uma mensagem que cita só o NOME da variável
 * problemática — nunca o valor recebido, mesmo quando o valor é inválido
 * (ex.: URL malformada).
 */

const REQUIRED_IN_PRODUCTION = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "NEXT_PUBLIC_SITE_URL",
  "PAYMENT_ENCRYPTION_KEY",
  "CRON_SECRET",
] as const;

function isLocalHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname.endsWith(".local");
}

function checkHttpsPublicUrl(varName: string, value: string | undefined, problems: string[]): void {
  if (!value) return; // já reportado pela checagem de presença
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    problems.push(`${varName} (não é uma URL válida)`);
    return;
  }
  if (parsed.protocol !== "https:") {
    problems.push(`${varName} (deve usar https em produção)`);
  }
  if (isLocalHostname(parsed.hostname)) {
    problems.push(`${varName} (não pode apontar para localhost em produção)`);
  }
}

export function assertProductionEnv(): void {
  if (process.env.NODE_ENV !== "production") return;

  const problems: string[] = [];

  for (const name of REQUIRED_IN_PRODUCTION) {
    if (!process.env[name] || process.env[name]!.trim().length === 0) {
      problems.push(name);
    }
  }

  checkHttpsPublicUrl("NEXT_PUBLIC_SITE_URL", process.env.NEXT_PUBLIC_SITE_URL, problems);
  checkHttpsPublicUrl("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL, problems);

  if (process.env.PAYMENT_GATEWAY_MODE === "fake") {
    problems.push("PAYMENT_GATEWAY_MODE (não pode ser 'fake' em produção)");
  }

  if (problems.length > 0) {
    const unique = problems.filter((name, index, all) => all.indexOf(name) === index);
    throw new Error(
      `Configuração de produção inválida — variável(is) de ambiente ausente(s) ou inválida(s): ${unique.join(", ")}. ` +
        "Corrija antes de iniciar a aplicação. Nenhum valor é exibido nesta mensagem.",
    );
  }
}
