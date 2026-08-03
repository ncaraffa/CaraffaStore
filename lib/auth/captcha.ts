export interface CaptchaVerificationResult {
  valid: boolean;
  reason?: "missing_token" | "captcha_not_configured" | "verification_request_failed" | "rejected";
}

function isCaptchaEnabled(): boolean {
  return process.env.CAPTCHA_ENABLED === "true";
}

/**
 * T2-DEC-011: suporte preparado para CAPTCHA em cadastro e recuperação,
 * sem obrigação de ativar no desenvolvimento local. Desativado (padrão
 * local): sempre válido, não bloqueia o fluxo. Ativado: verifica o token
 * contra o provedor configurado (hcaptcha/turnstile) via chamada HTTP
 * server-side — a chave secreta nunca é enviada ao navegador nem
 * aparece em log (só o resultado boolean é usado pelo chamador).
 */
export async function verifyCaptcha(
  token: string | null | undefined,
  options: { fetchImpl?: typeof fetch } = {},
): Promise<CaptchaVerificationResult> {
  if (!isCaptchaEnabled()) {
    return { valid: true };
  }

  if (!token) {
    return { valid: false, reason: "missing_token" };
  }

  const provider = process.env.CAPTCHA_PROVIDER === "turnstile" ? "turnstile" : "hcaptcha";
  const secret = process.env.CAPTCHA_SECRET_KEY;
  if (!secret) {
    return { valid: false, reason: "captcha_not_configured" };
  }

  const verifyUrl =
    provider === "turnstile"
      ? "https://challenges.cloudflare.com/turnstile/v0/siteverify"
      : "https://hcaptcha.com/siteverify";

  const fetchImpl = options.fetchImpl ?? fetch;
  const body = new URLSearchParams({ secret, response: token });

  let res: Response;
  try {
    res = await fetchImpl(verifyUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
  } catch {
    return { valid: false, reason: "verification_request_failed" };
  }

  if (!res.ok) {
    return { valid: false, reason: "verification_request_failed" };
  }

  const data = (await res.json()) as { success?: boolean };
  return data.success ? { valid: true } : { valid: false, reason: "rejected" };
}
