"use server";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { signupSchema } from "@/lib/auth/schemas";
import { fieldErrorsFromZod } from "@/lib/auth/form-errors";
import { checkRateLimit, getClientIp } from "@/lib/auth/rate-limit";
import { verifyCaptcha } from "@/lib/auth/captcha";
import { isPasswordLeaked } from "@/lib/auth/password-policy";
import { logAuditEvent } from "@/lib/audit/log";
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
  const rateLimit = checkRateLimit(ip, "signup");
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
    const { data, error } = await supabase.auth.signUp({
      email: parsed.data.email,
      password: parsed.data.password,
      options: { emailRedirectTo: absoluteUrl("/auth/confirm") },
    });

    // Sinal documentado do GoTrue para "e-mail já registrado": o usuário
    // retornado vem com identities vazio, sem lançar erro. Não podemos
    // reagir de forma diferente a esse caso — resultaria em mensagem
    // diferenciada e permitiria enumerar contas existentes.
    const alreadyRegistered = !error && !!data.user && data.user.identities?.length === 0;

    if (!error && !alreadyRegistered && data.user) {
      await logAuditEvent({
        actorUserId: data.user.id,
        action: "signup_completed",
        targetType: "auth_user",
        targetId: data.user.id,
      });
    }
  } catch {
    // Mesma mensagem genérica mesmo em falha técnica: não revelar
    // detalhes que ajudem a diferenciar "conta já existe" de "erro
    // interno" (ver docs/HANDOFF.md — tradeoff deliberado).
  }

  return { status: "success", message: SIGNUP_RESULT_MESSAGE };
}
