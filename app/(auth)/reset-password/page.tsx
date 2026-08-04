import Link from "next/link";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isCurrentSessionRecovery } from "@/lib/tenant/recovery-session";
import { RESET_LINK_INVALID_MESSAGE } from "@/lib/auth/messages";
import { ResetPasswordForm } from "./reset-password-form";

// Sempre depende de sessão/cookies por requisição — nunca pode ser
// pré-renderizada estaticamente no build.
export const dynamic = "force-dynamic";

/**
 * BUG-T2-002 (qa/reports/TASK-002.md): não basta existir `user` — uma
 * sessão de login normal também tem `user`. Exige um grant de
 * recuperação ATIVO para a sessão ATUAL (lib/tenant/recovery-session.ts,
 * baseado em public.password_recovery_grants — emitido server-only só
 * depois de uma verificação real de token de recuperação, nunca por uma
 * sessão comum chamando uma RPC diretamente; nem no claim `amr` nem em
 * `next` — ver qa/reports/TASK-002-CLAUDE-VERIFICATION.md, BUG-CLAUDE-001).
 * A Server Action repete exatamente esta mesma checagem — a página não é
 * a única barreira.
 */
export default async function ResetPasswordPage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const authorized = user ? await isCurrentSessionRecovery(supabase) : false;

  if (!authorized) {
    return (
      <>
        <h1>Link inválido</h1>
        <p className="form-status" data-tone="error" role="alert">
          {RESET_LINK_INVALID_MESSAGE}
        </p>
        <p className="auth-links">
          <Link href="/forgot-password">Solicitar novo link</Link>
        </p>
      </>
    );
  }

  return (
    <>
      <h1>Definir nova senha</h1>
      <ResetPasswordForm />
    </>
  );
}
