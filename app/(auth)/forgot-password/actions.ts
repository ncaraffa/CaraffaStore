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
    // Grava o pedido PENDENTE de recuperação ANTES de disparar o
    // e-mail — é essa linha (supabase/migrations/0003_recovery_session.sql),
    // não a rota que recebe o `code` depois, que prova a finalidade do
    // fluxo (qa/reports/TASK-002-RETEST.md, BUG-RT2-001/003): sem um
    // pedido pendente correspondente, app/auth/recovery/route.ts recusa
    // o código e encerra a sessão, mesmo que a troca de código em si
    // tenha sido bem-sucedida. A função resolve o usuário pelo e-mail
    // internamente (anti-enumeração preservada — nenhuma linha é criada
    // nem erro aparece para um e-mail sem conta) e não é suficiente
    // sozinha para conceder acesso a /reset-password.
    await supabase.rpc("request_password_recovery_grant", { p_email: parsed.data.email });

    // Aponta para a rota DEDICADA de recuperação. A "solicitação de
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
