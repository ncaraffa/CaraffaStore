import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Confirme seu e-mail",
};

import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { LogoutButton } from "@/app/logout/logout-button";
import { ResendForm } from "./resend-form";
import styles from "../auth-form.module.css";

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
      <p className={styles.subtitle}>
        Enviamos um link de confirmação para <strong>{user.email}</strong>. Verifique sua caixa de entrada (e o
        spam) antes de continuar. <strong>O e-mail pode levar alguns minutos para chegar</strong> — vale esperar
        antes de pedir um novo envio.
      </p>
      <ResendForm />
      <div style={{ marginTop: "1.25rem" }}>
        <LogoutButton />
      </div>
    </>
  );
}
