"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { resetPasswordSchema } from "@/lib/auth/schemas";
import { fieldErrorsFromZod } from "@/lib/auth/form-errors";
import { isPasswordLeaked } from "@/lib/auth/password-policy";
import {
  claimRecoveryGrantForPasswordChange,
  isCurrentSessionRecovery,
  RECOVERY_NONCE_COOKIE,
} from "@/lib/tenant/recovery-session";
import { completePasswordRecoveryAttempt } from "@/lib/supabase/service-only/recovery-completion";
import { RESET_LINK_INVALID_MESSAGE } from "@/lib/auth/messages";

/**
 * Tentativas de chamar complete_password_recovery_attempt depois de
 * updateUser() já ter tido sucesso real — cobre só falhas transitórias
 * (ex.: rede) entre as duas chamadas dentro da MESMA requisição. Nunca
 * bloqueia o usuário se todas falharem: a senha já mudou de verdade
 * nesse ponto, e complete_password_recovery_attempt é idempotente (uma
 * chamada bem-sucedida grava completed_at; retries adicionais com o
 * mesmo attempt_id/capability encontram completed_at preenchido e
 * retornam false sem duplicar auditoria) — ver
 * qa/reports/TASK-002-CLAUDE-VERIFICATION-3.md, "FALHA DE COMPLETION
 * APÓS SENHA ALTERADA".
 */
const COMPLETION_RETRY_ATTEMPTS = 2;

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
  // depois (qa/reports/TASK-002-RETEST.md, BUG-RT2-002). O UPDATE
  // condicional dentro da função (estado pending -> claimed) é o que
  // garante que, sob duas requisições concorrentes com a mesma sessão,
  // exatamente uma consegue prosseguir: a segunda encontra 0 linhas
  // elegíveis (claimed_at já não é mais null) e recebe `claimed: false`
  // aqui, sem nunca chamar updateUser().
  //
  // Terceira correção pós-QA (qa/reports/TASK-002-CLAUDE-VERIFICATION.md,
  // BUG-CLAUDE-001): a reivindicação agora também exige o nonce bruto
  // devolvido por app/auth/recovery/route.ts num cookie HttpOnly — sem
  // ele, mesmo uma sessão com uma tentativa pendente de verdade não
  // consegue reivindicar nada.
  //
  // Quinta correção pós-QA (revisão externa sobre
  // qa/reports/TASK-002-CLAUDE-VERIFICATION-3.md, BUG-CLAUDE-VERIF3-001):
  // o claim também devolve `attemptId`/`completionCapability` — a
  // conclusão real (completePasswordRecoveryAttempt, abaixo) exige os
  // dois, e só é chamada DEPOIS de updateUser() ter sucesso real. Nenhum
  // mecanismo automático conclui a tentativa por conta própria (a antiga
  // trigger `on_auth_user_password_changed` foi removida — ela
  // correlacionava só por user_id, sem provar causalidade real).
  const cookieStore = await cookies();
  const nonce = cookieStore.get(RECOVERY_NONCE_COOKIE)?.value;
  const { claimed, attemptId, completionCapability } = await claimRecoveryGrantForPasswordChange(supabase, nonce);
  cookieStore.delete(RECOVERY_NONCE_COOKIE);
  if (!claimed || !attemptId || !completionCapability) {
    return { status: "error", message: RESET_LINK_INVALID_MESSAGE };
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    // A tentativa já foi reivindicada (estado claimed) pela chamada
    // acima — não há como "devolvê-la" com segurança (reabriria a mesma
    // janela de reuso que a atomicidade acima fecha): completed_at
    // permanece null PARA SEMPRE nesta linha, então nenhuma tentativa
    // futura pode reivindicá-la de novo nem concluí-la, e nenhuma troca
    // de senha NÃO relacionada consegue concluí-la depois (fecha
    // BUG-CLAUDE-VERIF3-001, qa/reports/TASK-002-CLAUDE-VERIFICATION-3.md
    // — a conclusão exige attempt_id + completion capability exatos
    // desta requisição, nunca "qualquer troca de senha por user_id").
    // `password_recovery_completed` nunca é gravado neste caminho,
    // porque encrypted_password nunca mudou de fato e
    // completePasswordRecoveryAttempt não é sequer chamada. Falha
    // segura: encerra a sessão e exige uma nova recuperação (novo
    // verifyOtp real, que revoga esta tentativa automaticamente via
    // issue_password_recovery_grant), em vez de permitir nova tentativa
    // com a mesma linha.
    await supabase.auth.signOut();
    return { status: "error", message: RESET_LINK_INVALID_MESSAGE };
  }

  // updateUser() teve sucesso real: a senha JÁ MUDOU no GoTrue. A
  // conclusão explícita, server-only (lib/supabase/service-only/recovery-completion.ts)
  // exige attemptId + completionCapability EXATOS desta tentativa e
  // confirma internamente que a credencial realmente mudou desde o claim
  // — nunca correlaciona por user_id sozinho (fecha BUG-CLAUDE-VERIF3-001).
  // Um pequeno número de tentativas cobre só falha transitória entre as
  // duas chamadas: se todas falharem, a troca de senha em si já teve
  // sucesso e o usuário não deve ficar bloqueado por isso — só o evento
  // de auditoria de conclusão pode ficar ausente nesse caso raro (ver
  // comentário de COMPLETION_RETRY_ATTEMPTS acima). Nunca duplica
  // auditoria: a função de conclusão é idempotente.
  for (let attempt = 0; attempt < COMPLETION_RETRY_ATTEMPTS; attempt++) {
    const completed = await completePasswordRecoveryAttempt({ attemptId, completionCapability });
    if (completed) break;
  }

  await supabase.auth.signOut();
  redirect("/login");
}
