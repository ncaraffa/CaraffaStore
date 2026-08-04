"use server";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { forgotPasswordSchema } from "@/lib/auth/schemas";
import { fieldErrorsFromZod } from "@/lib/auth/form-errors";
import { buildRateLimitKey, checkRateLimit, getClientIp } from "@/lib/auth/rate-limit";
import { verifyCaptcha } from "@/lib/auth/captcha";
import { absoluteUrl } from "@/lib/auth/site-url";
import { CAPTCHA_FAILED_MESSAGE, RATE_LIMITED_MESSAGE, RECOVERY_REQUEST_MESSAGE } from "@/lib/auth/messages";

export interface ForgotPasswordState {
  status: "idle" | "error" | "success";
  message?: string;
  fieldErrors?: Record<string, string>;
}

export async function forgotPasswordAction(
  _prevState: ForgotPasswordState,
  formData: FormData,
): Promise<ForgotPasswordState> {
  const parsed = forgotPasswordSchema.safeParse({ email: String(formData.get("email") ?? "") });
  if (!parsed.success) {
    return { status: "error", fieldErrors: fieldErrorsFromZod(parsed.error) };
  }

  const ip = await getClientIp();
  const key = buildRateLimitKey({ action: "password_recovery", ip, email: parsed.data.email });
  const rateLimit = checkRateLimit(key, "password_recovery");
  if (!rateLimit.allowed) {
    return { status: "error", message: RATE_LIMITED_MESSAGE };
  }

  const captchaToken = formData.get("captchaToken");
  const captcha = await verifyCaptcha(typeof captchaToken === "string" ? captchaToken : null);
  if (!captcha.valid) {
    return { status: "error", message: CAPTCHA_FAILED_MESSAGE };
  }

  try {
    const supabase = await createServerSupabaseClient();
    // Terceira correção pós-QA (revisão externa sobre
    // qa/reports/TASK-002-CLAUDE-VERIFICATION.md, BUG-CLAUDE-003): esta
    // Server Action volta a fazer SÓ UMA COISA — disparar o e-mail. Não
    // grava mais nenhuma linha/grant aqui (a função
    // `request_password_recovery_grant`, que era uma RPC pública
    // chamável fora desta Server Action, sem rate limit nem CAPTCHA, foi
    // removida por completo — supabase/migrations/0003_recovery_session.sql).
    // O único jeito de obter privilégio de recuperação agora é o GoTrue
    // validar de verdade um token_hash real de type=recovery em
    // app/auth/recovery/route.ts, que emite o grant server-side depois
    // disso (fecha também BUG-CLAUDE-001). Anti-enumeração é nativa do
    // GoTrue: resetPasswordForEmail responde com sucesso mesmo para
    // e-mail inexistente, sem revelar a diferença e sem gravar nada.
    await supabase.auth.resetPasswordForEmail(parsed.data.email, {
      redirectTo: absoluteUrl("/auth/recovery"),
    });
  } catch {
    // Mesma mensagem mesmo em falha técnica.
  }

  return { status: "success", message: RECOVERY_REQUEST_MESSAGE };
}
