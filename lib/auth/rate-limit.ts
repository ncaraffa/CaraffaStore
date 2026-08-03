import { headers } from "next/headers";

export type RateLimitedAction = "signup" | "login" | "password_recovery" | "resend_verification";

export interface RateLimitConfig {
  windowMs: number;
  max: number;
}

/**
 * Limites de aplicação para cadastro/login/recuperação (TASK-002:
 * "rate limiting é obrigatório"). Somam-se aos limites nativos do GoTrue
 * (supabase/config.toml [auth.rate_limit]) como segunda camada — não os
 * substituem.
 */
export const RATE_LIMITS: Record<RateLimitedAction, RateLimitConfig> = {
  signup: { windowMs: 5 * 60_000, max: 5 },
  login: { windowMs: 5 * 60_000, max: 10 },
  password_recovery: { windowMs: 5 * 60_000, max: 5 },
  resend_verification: { windowMs: 60_000, max: 1 },
};

interface Bucket {
  count: number;
  windowStart: number;
}

/**
 * Estado em memória, por processo. Suficiente para dev local/MVP de um
 * único processo Next.js. Em produção com múltiplas instâncias precisa
 * de um armazenamento compartilhado (ex.: Redis/Upstash) — documentado
 * como pendência em docs/HANDOFF.md, não implementado nesta tarefa.
 */
const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
  allowed: boolean;
  retryAfterMs: number;
}

export function checkRateLimit(
  key: string,
  action: RateLimitedAction,
  now: number = Date.now(),
): RateLimitResult {
  const config = RATE_LIMITS[action];
  const bucketKey = `${action}:${key}`;
  const bucket = buckets.get(bucketKey);

  if (!bucket || now - bucket.windowStart >= config.windowMs) {
    buckets.set(bucketKey, { count: 1, windowStart: now });
    return { allowed: true, retryAfterMs: 0 };
  }

  if (bucket.count >= config.max) {
    return { allowed: false, retryAfterMs: config.windowMs - (now - bucket.windowStart) };
  }

  bucket.count += 1;
  return { allowed: true, retryAfterMs: 0 };
}

export function resetRateLimit(key: string, action: RateLimitedAction): void {
  buckets.delete(`${action}:${key}`);
}

/** Exposto só para limpar estado entre testes. */
export function __clearAllRateLimits(): void {
  buckets.clear();
}

/**
 * IP do chamador a partir dos headers padrão de proxy reverso. Em dev
 * local sem proxy à frente, normalmente não há `x-forwarded-for` — cai
 * em "unknown", o que ainda assim aplica o limite (compartilhado entre
 * todo tráfego não identificado) em vez de desativá-lo silenciosamente.
 * Atrás de um proxy real, o cabeçalho correto precisa ser confirmado no
 * ambiente de deploy (fora do escopo desta tarefa).
 */
export async function getClientIp(): Promise<string> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = h.get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}
