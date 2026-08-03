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
    // Aponta para a rota DEDICADA de recuperação — é ela (não um `next`
    // controlável pelo cliente) que classifica o fluxo depois da troca
    // de código (BUG-T2-003, qa/reports/TASK-002.md). A "solicitação de
    // recuperação" em si não é gravada em public.audit_log: o próprio
    // GoTrue já registra isso em auth.audit_log_entries
    // (user_recovery_requested), confirmado contra o Supabase local
    // real — reimplementar exigiria aceitar actor_user_id vindo de uma
    // chamada anônima, exatamente a forja que a TASK-002 proíbe
    // (BUG-T2-004).
    await supabase.auth.resetPasswordForEmail(parsed.data.email, {
      redirectTo: absoluteUrl("/auth/recovery"),
    });
  } catch {
    // Mesma mensagem mesmo em falha técnica.
  }

  return { status: "success", message: RECOVERY_REQUEST_MESSAGE };
}
