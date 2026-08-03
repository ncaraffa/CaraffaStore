"use server";

import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { resetPasswordSchema } from "@/lib/auth/schemas";
import { fieldErrorsFromZod } from "@/lib/auth/form-errors";
import { isPasswordLeaked } from "@/lib/auth/password-policy";
import { claimRecoveryGrantForPasswordChange, isCurrentSessionRecovery } from "@/lib/tenant/recovery-session";
import { RESET_LINK_INVALID_MESSAGE } from "@/lib/auth/messages";

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

  // Reivindicação atômica IMEDIATAMENTE ANTES da troca de senha — nunca
  // depois (qa/reports/TASK-002-RETEST.md, BUG-RT2-002). O DELETE
  // condicional dentro da função é o que garante que, sob duas
  // requisições concorrentes com a mesma sessão, exatamente uma
  // consegue prosseguir: a segunda encontra 0 linhas (a primeira já
  // apagou) e recebe `false` aqui, sem nunca chamar updateUser().
  const claimed = await claimRecoveryGrantForPasswordChange(supabase);
  if (!claimed) {
    return { status: "error", message: RESET_LINK_INVALID_MESSAGE };
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    // O grant já foi consumido pela reivindicação acima — não há como
    // "devolvê-lo" com segurança (reabriria a mesma janela de reuso que
    // a atomicidade acima fecha). Falha segura: encerra a sessão e exige
    // uma nova recuperação, em vez de permitir nova tentativa com o
    // mesmo grant.
    await supabase.auth.signOut();
    return { status: "error", message: RESET_LINK_INVALID_MESSAGE };
  }

  // Auditoria já gravada dentro de claim_recovery_grant_for_password_change()
  // (mesma transação atômica do consumo do grant) — nenhuma RPC de
  // auditoria separada e chamável isoladamente existe para este evento
  // (BUG-RT2-005, qa/reports/TASK-002-RETEST.md).
  await supabase.auth.signOut();
  redirect("/login");
}
