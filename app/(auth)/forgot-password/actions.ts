"use server";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { forgotPasswordSchema } from "@/lib/auth/schemas";
import { fieldErrorsFromZod } from "@/lib/auth/form-errors";
import { checkRateLimit, getClientIp } from "@/lib/auth/rate-limit";
import { verifyCaptcha } from "@/lib/auth/captcha";
import { absoluteUrl } from "@/lib/auth/site-url";
import { hashForAudit, logAuditEvent } from "@/lib/audit/log";
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
  const rateLimit = checkRateLimit(ip, "password_recovery");
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
    // `next=/reset-password` é o sinal que app/auth/confirm/route.ts usa
    // para distinguir esta troca de código (recuperação) da de cadastro
    // — o GoTrue preserva a query de `redirectTo` ao anexar `code`.
    await supabase.auth.resetPasswordForEmail(parsed.data.email, {
      redirectTo: absoluteUrl("/auth/confirm?next=%2Freset-password"),
    });

    // resetPasswordForEmail não sinaliza se o e-mail correspondia a uma
    // conta real (diferente do signUp) — não há como logar de forma
    // diferenciada sem enumerar. Registra só a solicitação, com um hash
    // do e-mail em vez do valor em texto puro.
    await logAuditEvent({
      action: "password_recovery_requested",
      targetType: "email_hash",
      targetId: hashForAudit(parsed.data.email),
    });
  } catch {
    // Mesma mensagem mesmo em falha técnica.
  }

  return { status: "success", message: RECOVERY_REQUEST_MESSAGE };
}
