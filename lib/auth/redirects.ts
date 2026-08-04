/**
 * Allowlist de destinos internos de redirecionamento (login `?next=`,
 * confirmação de e-mail, recuperação de senha). Nenhum outro valor é
 * aceito — bloqueia open redirect (TASK-002, "Segurança inegociável").
 */
const ALLOWED_INTERNAL_PATHS = [
  "/",
  "/login",
  "/signup",
  "/verify",
  "/forgot-password",
  "/reset-password",
  "/auth/confirm",
  "/onboarding",
  "/select-store",
  "/pending-payment",
  "/suspended",
  "/dashboard",
] as const;

/**
 * True only for a same-origin, relative path that resolves to (or under)
 * one of ALLOWED_INTERNAL_PATHS. Rejects absolute URLs, protocol-relative
 * `//host` and backslash variants some browsers normalize to `//`, and
 * anything that fails to parse as a path.
 */
export function isAllowedRedirect(candidate: string | null | undefined): candidate is string {
  if (!candidate || typeof candidate !== "string") return false;
  if (candidate.length > 512) return false;
  if (candidate.includes("\\") || candidate.includes("\0")) return false;
  if (!candidate.startsWith("/") || candidate.startsWith("//")) return false;

  let pathname: string;
  try {
    // Resolver contra uma base fixa normaliza `..`/`.` no caminho antes
    // da checagem de prefixo, então "/onboarding/../../evil" não escapa
    // a allowlist por meio de dot-segments.
    pathname = new URL(candidate, "http://internal.invalid").pathname;
  } catch {
    return false;
  }

  return ALLOWED_INTERNAL_PATHS.some(
    (allowed) => pathname === allowed || pathname.startsWith(`${allowed}/`),
  );
}

/** Devolve `candidate` se for um destino interno permitido, senão `fallback`. */
export function safeRedirectTarget(candidate: string | null | undefined, fallback = "/"): string {
  return isAllowedRedirect(candidate) ? candidate : fallback;
}
