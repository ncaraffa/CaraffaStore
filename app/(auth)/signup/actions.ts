"use server";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { signupSchema } from "@/lib/auth/schemas";
import { fieldErrorsFromZod } from "@/lib/auth/form-errors";
import { buildRateLimitKey, checkRateLimit, getClientIp } from "@/lib/auth/rate-limit";
import { verifyCaptcha } from "@/lib/auth/captcha";
import { isPasswordLeaked } from "@/lib/auth/password-policy";
import { absoluteUrl } from "@/lib/auth/site-url";
import {
  CAPTCHA_FAILED_MESSAGE,
  RATE_LIMITED_MESSAGE,
  SIGNUP_RESULT_MESSAGE,
} from "@/lib/auth/messages";

export interface SignupState {
  status: "idle" | "error" | "success";
  message?: string;
  fieldErrors?: Record<string, string>;
}

export async function signupAction(_prevState: SignupState, formData: FormData): Promise<SignupState> {
  const parsed = signupSchema.safeParse({
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
  });

  if (!parsed.success) {
    return { status: "error", fieldErrors: fieldErrorsFromZod(parsed.error) };
  }

  const ip = await getClientIp();
  const key = buildRateLimitKey({ action: "signup", ip, email: parsed.data.email });
  const rateLimit = checkRateLimit(key, "signup");
  if (!rateLimit.allowed) {
    return { status: "error", message: RATE_LIMITED_MESSAGE };
  }

  const captchaToken = formData.get("captchaToken");
  const captcha = await verifyCaptcha(typeof captchaToken === "string" ? captchaToken : null);
  if (!captcha.valid) {
    return { status: "error", message: CAPTCHA_FAILED_MESSAGE };
  }

  const leaked = await isPasswordLeaked(parsed.data.password);
  if (leaked) {
    return {
      status: "error",
      fieldErrors: { password: "Esta senha apareceu em vazamentos conhecidos publicamente. Escolha outra." },
    };
  }

  try {
    const supabase = await createServerSupabaseClient();
    // "cadastro concluído" não é gravado em public.audit_log: o próprio
    // GoTrue já registra isso em auth.audit_log_entries (user_signedup),
    // confirmado contra o Supabase local real. Reimplementar exigiria
    // aceitar actor_user_id vindo de uma chamada ainda sem sessão
    // (email_confirmations pendente) — exatamente a forja que a
    // TASK-002 proíbe (BUG-T2-004, qa/reports/TASK-002.md).
    await supabase.auth.signUp({
      email: parsed.data.email,
      password: parsed.data.password,
      options: { emailRedirectTo: absoluteUrl("/auth/confirm") },
    });
  } catch {
    // Mesma mensagem genérica mesmo em falha técnica: não revelar
    // detalhes que ajudem a diferenciar "conta já existe" de "erro
    // interno" (ver docs/handoff.md — tradeoff deliberado).
  }

  return { status: "success", message: SIGNUP_RESULT_MESSAGE };
}
