"use server";

import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { resetPasswordSchema } from "@/lib/auth/schemas";
import { fieldErrorsFromZod } from "@/lib/auth/form-errors";
import { isPasswordLeaked } from "@/lib/auth/password-policy";
import { consumeRecoveryGrant, isCurrentSessionRecovery } from "@/lib/tenant/recovery-session";
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
  // Checa a sessão de recuperação ANTES de validar/consultar a senha: um
  // visitante sem grant de recuperação válido (login normal, link
  // expirado/reutilizado, ou acesso direto sem passar pelo link) não
  // deve disparar a checagem de senha vazada (chamada de rede externa
  // quando HIBP_PASSWORD_CHECK_ENABLED estiver ativo) nem qualquer outro
  // trabalho além de mostrar o erro. Mesma checagem exata da página —
  // não depende só dela (BUG-T2-002, qa/reports/TASK-002.md).
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const authorized = user ? await isCurrentSessionRecovery(supabase) : false;
  if (!user || !authorized) {
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

  // Auditoria via função SECURITY DEFINER (nunca service role — lê
  // auth.uid() da própria sessão que acabou de trocar a senha).
  const { error: auditError } = await supabase.rpc("log_password_recovery_completed");
  if (auditError) {
    console.error("[reset-password] falha ao registrar auditoria:", auditError.message);
  }

  // Encerra o contexto especial de recuperação: apaga o grant (dupla
  // garantia, além do signOut() abaixo) e derruba a sessão — o token não
  // pode ser reutilizado, e a próxima autenticação exige a senha nova.
  await consumeRecoveryGrant(supabase);
  await supabase.auth.signOut();
  redirect("/login");
}
