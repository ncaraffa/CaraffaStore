import { createHash } from "node:crypto";
import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { Logo } from "@/components/ui/Logo";
import styles from "./invite.module.css";

export const dynamic = "force-dynamic";

const MESSAGES: Record<string, string> = {
  invitation_not_found: "Este convite não existe ou já foi cancelado.",
  invitation_already_used: "Este convite já foi utilizado.",
  invitation_expired: "Este convite expirou. Peça um novo ao proprietário da loja.",
  invitation_email_mismatch:
    "Este convite foi enviado para outro e-mail. Entre com a conta que recebeu o convite.",
  max_team_members_reached:
    "A equipe desta loja já está cheia. Peça ao proprietário para liberar um assento.",
};

/**
 * Aceitação de convite de equipe.
 *
 * O token em claro só existe no link — o banco guarda apenas o SHA-256,
 * calculado aqui no servidor. Nada do token vai para log, audit ou
 * mensagem de erro.
 *
 * Quem valida (single-use, prazo, e-mail casado, assento disponível) é
 * workspace_accept_invitation, sob lock. Esta página só traduz o
 * resultado.
 */
export default async function AcceptInvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    // Preserva o destino: depois do login o convite é aceito sem o
    // usuário precisar reabrir o e-mail.
    redirect(`/login?next=${encodeURIComponent(`/convite/${token}`)}`);
  }

  const tokenHash = createHash("sha256").update(token).digest("hex");
  const { error } = await supabase.rpc("workspace_accept_invitation", { p_token_hash: tokenHash });

  if (!error) {
    redirect("/select-store");
  }

  const known = Object.keys(MESSAGES).find((code) => error.message.includes(code));
  const message = known ? MESSAGES[known]! : "Não foi possível aceitar o convite. Tente novamente.";

  return (
    <main className={styles.page}>
      <div className={styles.brand}>
        <Logo />
      </div>
      <Card>
        <h1 className={styles.title}>Convite de equipe</h1>
        <Alert tone="danger">{message}</Alert>
        <a className={styles.link} href="/dashboard">
          Ir para o painel
        </a>
      </Card>
    </main>
  );
}
