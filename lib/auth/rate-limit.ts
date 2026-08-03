import { headers } from "next/headers";
import { hashIdentifier } from "@/lib/security/hash";

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

export interface RateLimitResult {
  allowed: boolean;
  retryAfterMs: number;
}

/**
 * Backend de armazenamento do limiter, isolado por interface para
 * permitir substituição futura (Redis/Upstash) sem mudar nenhum
 * chamador (qa/reports/TASK-002.md, BUG-T2-005, item 6). O backend
 * padrão é em memória, por processo — ver aviso na classe abaixo.
 */
export interface RateLimitBackend {
  hit(bucketKey: string, windowMs: number, max: number, now: number): RateLimitResult;
  reset(bucketKey: string): void;
  clear(): void;
}

interface Bucket {
  count: number;
  windowStart: number;
}

/**
 * Backend em memória, por processo. Adequado SOMENTE para desenvolvimento
 * local ou uma única instância — reinício do processo zera os limites, e
 * múltiplas instâncias (ex.: várias réplicas atrás de um load balancer)
 * NÃO compartilham este estado entre si, então um atacante distribuído
 * entre instâncias não é limitado de forma agregada. Isto NÃO é
 * apresentado como proteção pronta para produção multi-instância — para
 * isso, plugar um RateLimitBackend baseado em armazenamento compartilhado
 * (Redis/Upstash) via setRateLimitBackend() abaixo.
 */
export class InMemoryRateLimitBackend implements RateLimitBackend {
  private readonly buckets = new Map<string, Bucket>();

  hit(bucketKey: string, windowMs: number, max: number, now: number): RateLimitResult {
    const bucket = this.buckets.get(bucketKey);

    if (!bucket || now - bucket.windowStart >= windowMs) {
      this.buckets.set(bucketKey, { count: 1, windowStart: now });
      return { allowed: true, retryAfterMs: 0 };
    }

    if (bucket.count >= max) {
      return { allowed: false, retryAfterMs: windowMs - (now - bucket.windowStart) };
    }

    bucket.count += 1;
    return { allowed: true, retryAfterMs: 0 };
  }

  reset(bucketKey: string): void {
    this.buckets.delete(bucketKey);
  }

  clear(): void {
    this.buckets.clear();
  }
}

let backend: RateLimitBackend = new InMemoryRateLimitBackend();

/**
 * Plugável para um backend com armazenamento compartilhado (ex.:
 * Redis/Upstash) em produção multi-instância. Não implementado nesta
 * tarefa — fora do escopo aprovado (qa/reports/TASK-002.md, seção 5:
 * "Não implemente Redis ou infraestrutura distribuída nesta tarefa").
 */
export function setRateLimitBackend(customBackend: RateLimitBackend): void {
  backend = customBackend;
}

export function checkRateLimit(
  key: string,
  action: RateLimitedAction,
  now: number = Date.now(),
): RateLimitResult {
  const config = RATE_LIMITS[action];
  return backend.hit(`${action}:${key}`, config.windowMs, config.max, now);
}

export function resetRateLimit(key: string, action: RateLimitedAction): void {
  backend.reset(`${action}:${key}`);
}

/** Exposto só para limpar estado entre testes. */
export function __clearAllRateLimits(): void {
  backend.clear();
}

export interface RateLimitKeyParams {
  action: RateLimitedAction;
  /**
   * Resultado de getClientIp() — já respeita a política de trusted
   * proxy. Ignorado quando `userId` está presente (identidade mais
   * forte disponível), então opcional nesse caso.
   */
  ip?: string;
  /** E-mail alvo da ação, quando existir (cadastro/login/recuperação). */
  email?: string;
  /** Usuário autenticado, quando existir (ex.: reenvio de verificação). */
  userId?: string;
}

/**
 * Chave combinada, não só IP (qa/reports/TASK-002.md, BUG-T2-005, item
 * 4): usuário autenticado é a identidade mais forte disponível; senão,
 * combina um hash do e-mail alvo (nunca o valor em texto puro — item 5)
 * com o IP resolvido (que já é "untrusted-origin" sem proxy confiável
 * configurado, nunca um header forjável — ver getClientIp()). Isso
 * garante limite por e-mail-alvo mesmo quando o IP não pode ser
 * identificado de forma confiável, sem nunca gravar e-mail nem IP em log.
 */
export function buildRateLimitKey(params: RateLimitKeyParams): string {
  if (params.userId) {
    return `user:${params.userId}`;
  }
  const emailPart = params.email ? `email:${hashIdentifier(params.email)}` : "email:none";
  return `${emailPart}|ip:${params.ip ?? "untrusted-origin"}`;
}

const TRUSTED_PROXY_ENABLED = process.env.TRUSTED_PROXY_ENABLED === "true";

/**
 * IP do chamador — SÓ resolvido a partir de `x-forwarded-for`/`x-real-ip`
 * quando `TRUSTED_PROXY_ENABLED=true` está explicitamente configurado.
 * Sem isso, esses headers são enviados pelo PRÓPRIO CLIENTE em qualquer
 * requisição direta (sem um proxy reverso confiável reescrevendo-os), e
 * tratá-los como identidade permitiria bypass trivial do rate limit
 * bastando forjar um valor novo a cada tentativa (qa/reports/TASK-002.md,
 * BUG-T2-005, itens 1–3). Nesse caso (padrão), todo tráfego não
 * identificável cai na MESMA chave — mais restritivo, nunca mais
 * permissivo, e combinado com o hash do e-mail-alvo em
 * buildRateLimitKey() para não depender só do IP de qualquer forma.
 *
 * `TRUSTED_PROXY_ENABLED=true` só deve ser ligado atrás de um proxy que
 * SOBRESCREVE esses headers (nunca repassa o que o cliente original
 * enviou) — confirmar isso no ambiente de deploy antes de ativar; fora
 * do escopo desta tarefa validar contra um proxy de produção real.
 */
export async function getClientIp(): Promise<string> {
  if (!TRUSTED_PROXY_ENABLED) {
    return "untrusted-origin";
  }

  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = h.get("x-real-ip");
  if (real) return real.trim();
  return "untrusted-origin";
}
