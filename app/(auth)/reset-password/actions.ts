"use server";

import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { resetPasswordSchema } from "@/lib/auth/schemas";
import { fieldErrorsFromZod } from "@/lib/auth/form-errors";
import { isPasswordLeaked } from "@/lib/auth/password-policy";
import { logAuditEvent } from "@/lib/audit/log";
import { GENERIC_UNEXPECTED_ERROR_MESSAGE, RESET_LINK_INVALID_MESSAGE } from "@/lib/auth/messages";

export interface ResetPasswordState {
  status: "idle" | "error";
  message?: string;
  fieldErrors?: Record<string, string>;
}

export async function resetPasswordAction(
  _prevState: ResetPasswordState,
  formData: FormData,
): Promise<ResetPasswordState> {
  // Checa a sessão ANTES de validar/consultar a senha: um visitante sem
  // sessão de recuperação válida (link expirado/reutilizado, ou acesso
  // direto sem passar pelo link) não deve disparar a checagem de senha
  // vazada (chamada de rede externa quando HIBP_PASSWORD_CHECK_ENABLED
  // estiver ativo) nem qualquer outro trabalho além de mostrar o erro.
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { status: "error", message: RESET_LINK_INVALID_MESSAGE };
  }

  const parsed = resetPasswordSchema.safeParse({ password: String(formData.get("password") ?? "") });
  if (!parsed.success) {
    return { status: "error", fieldErrors: fieldErrorsFromZod(parsed.error) };
  }

  const leaked = await isPasswordLeaked(parsed.data.password);
  if (leaked) {
    return {
      status: "error",
      fieldErrors: { password: "Esta senha apareceu em vazamentos conhecidos publicamente. Escolha outra." },
    };
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    return { status: "error", message: GENERIC_UNEXPECTED_ERROR_MESSAGE };
  }

  await logAuditEvent({
    actorUserId: user.id,
    action: "password_recovery_completed",
    targetType: "auth_user",
    targetId: user.id,
  });

  // Encerra a sessão de recuperação e força novo login com a senha nova
  // — não deixa a sessão de recuperação "aberta" reutilizável depois.
  await supabase.auth.signOut();
  redirect("/login");
}
