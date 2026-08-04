"use server";

import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { loginSchema } from "@/lib/auth/schemas";
import { fieldErrorsFromZod } from "@/lib/auth/form-errors";
import { buildRateLimitKey, checkRateLimit, getClientIp } from "@/lib/auth/rate-limit";
import { safeRedirectTarget } from "@/lib/auth/redirects";
import { LOGIN_FAILED_MESSAGE, RATE_LIMITED_MESSAGE } from "@/lib/auth/messages";

export interface LoginState {
  status: "idle" | "error";
  message?: string;
  fieldErrors?: Record<string, string>;
}

export async function loginAction(_prevState: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
  });

  if (!parsed.success) {
    return { status: "error", fieldErrors: fieldErrorsFromZod(parsed.error) };
  }

  const ip = await getClientIp();
  const key = buildRateLimitKey({ action: "login", ip, email: parsed.data.email });
  const rateLimit = checkRateLimit(key, "login");
  if (!rateLimit.allowed) {
    return { status: "error", message: RATE_LIMITED_MESSAGE };
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    // Mesma mensagem para credencial inválida, usuário inexistente e
    // conta não verificada (com enable_confirmations=true o GoTrue já
    // rejeita login de e-mail não confirmado) — nunca diferenciar
    // (T2-DEC-002/T2-DEC-011: login não pode confirmar existência).
    return { status: "error", message: LOGIN_FAILED_MESSAGE };
  }

  const next = String(formData.get("next") ?? "");
  redirect(safeRedirectTarget(next, "/"));
}
