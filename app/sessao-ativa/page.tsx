import { createServerSupabaseClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Logo } from "@/components/ui/Logo";
import { TakeoverForm } from "./takeover-form";
import styles from "./session-conflict.module.css";

export const dynamic = "force-dynamic";

/**
 * Tela de conflito de sessão do plano Essencial.
 *
 * O texto é deliberadamente honesto: dizemos que a conta está ativa em
 * OUTRO dispositivo/navegador — não que sabemos quem é a pessoa do outro
 * lado. Não há fingerprint aqui; o rótulo mostrado vem só do User-Agent
 * que o navegador já envia, e serve para o dono se reconhecer.
 */
export default async function SessionConflictPage({
  searchParams,
}: {
  searchParams: Promise<{ store?: string }>;
}) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { store } = await searchParams;
  const storeSlug = store ?? "";

  // Rótulo e último acesso da OUTRA sessão, para o dono decidir com
  // contexto. Só as próprias sessões do usuário são legíveis (RLS).
  const { data: others } = await supabase
    .from("app_sessions")
    .select("user_agent_label, last_seen_at")
    .is("revoked_at", null)
    .order("last_seen_at", { ascending: false })
    .limit(1);

  const other = others?.[0];
  const lastSeen = other?.last_seen_at
    ? new Date(other.last_seen_at).toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  return (
    <main className={styles.page}>
      <div className={styles.brand}>
        <Logo />
      </div>

      <Card>
        <h1 className={styles.title}>Sua conta já está ativa em outro dispositivo</h1>

        <p className={styles.body}>
          O plano Essencial permite uma sessão por vez. Para usar a CaraffaStore aqui, é preciso encerrar a
          sessão aberta no outro navegador.
        </p>

        {other?.user_agent_label && (
          <p className={styles.detail}>
            Sessão ativa: <strong>{other.user_agent_label}</strong>
            {lastSeen && <> · último acesso em {lastSeen}</>}
          </p>
        )}

        <TakeoverForm storeSlug={storeSlug} />

        <p className={styles.hint}>
          Ao continuar, a outra sessão é encerrada imediatamente e precisará entrar de novo.
        </p>

        <p className={styles.upsell}>
          Precisa de mais de uma pessoa operando a loja? Nos planos <strong>Crescimento</strong> e{" "}
          <strong>Profissional</strong> cada pessoa tem a própria conta, sem esse limite.
        </p>

        <form action="/logout" method="post" className={styles.logoutForm}>
          <button type="submit" className={styles.secondary}>
            Sair
          </button>
        </form>
      </Card>
    </main>
  );
}
