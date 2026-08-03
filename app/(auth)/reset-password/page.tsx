import Link from "next/link";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { RESET_LINK_INVALID_MESSAGE } from "@/lib/auth/messages";
import { ResetPasswordForm } from "./reset-password-form";

// Sempre depende de sessão/cookies por requisição — nunca pode ser
// pré-renderizada estaticamente no build.
export const dynamic = "force-dynamic";

export default async function ResetPasswordPage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
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
