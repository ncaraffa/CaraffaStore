import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { LogoutButton } from "@/app/logout/logout-button";
import { ResendForm } from "./resend-form";

export const dynamic = "force-dynamic";

export default async function VerifyPage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }
  if (user.email_confirmed_at) {
    redirect("/");
  }

  return (
    <>
      <h1>Confirme seu e-mail</h1>
      <p>
        Enviamos um link de confirmação para <strong>{user.email}</strong>. Verifique sua caixa de
        entrada (e o spam) antes de continuar.
      </p>
      <ResendForm />
      <LogoutButton />
    </>
  );
}
