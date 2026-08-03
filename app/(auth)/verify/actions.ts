"use server";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/auth/rate-limit";
import { absoluteUrl } from "@/lib/auth/site-url";
import { RATE_LIMITED_MESSAGE, RESEND_VERIFICATION_MESSAGE } from "@/lib/auth/messages";

export interface ResendState {
  status: "idle" | "error" | "success";
  message?: string;
}

export async function resendVerificationAction(_prevState: ResendState): Promise<ResendState> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { status: "success", message: RESEND_VERIFICATION_MESSAGE };
  }

  // Cooldown por usuário (auth.uid()), não só por IP — evita reenvio em
  // looping mesmo atrás de um proxy/NAT compartilhado.
  const rateLimit = checkRateLimit(user.id, "resend_verification");
  if (!rateLimit.allowed) {
    return { status: "error", message: RATE_LIMITED_MESSAGE };
  }

  if (user.email) {
    await supabase.auth.resend({
      type: "signup",
      email: user.email,
      options: { emailRedirectTo: absoluteUrl("/auth/confirm") },
    });
  }

  return { status: "success", message: RESEND_VERIFICATION_MESSAGE };
}
