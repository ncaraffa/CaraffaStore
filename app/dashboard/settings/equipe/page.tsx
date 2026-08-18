import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireStoreStatus } from "@/lib/tenant/access-control";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { QuotaMeter } from "@/components/dashboard/QuotaMeter";
import { getStoreQuotaUsage } from "@/lib/billing/entitlements";
import { quotaNotice } from "@/lib/billing/quota-messages";
import { Card } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { InviteForm, RemoveMemberForm, RevokeInviteForm } from "./team-forms";
import styles from "./team.module.css";

export const dynamic = "force-dynamic";

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/**
 * Configurações → Equipe.
 *
 * O assento é do WORKSPACE (workspace_members), não da loja: uma pessoa
 * com acesso a três lojas ocupa UM assento. Por isso a contagem exibida
 * aqui vem de store_quota_usage (que lê workspace_seat_count) e nunca de
 * um count sobre store_members.
 *
 * Esconder o formulário quando não há vaga é conveniência. Quem recusa o
 * convite excedente é o banco, com o workspace travado.
 */
export default async function TeamPage() {
  const supabase = await createServerSupabaseClient();
  const { store, role } = await requireStoreStatus(supabase, ["active"]);

  const usage = await getStoreQuotaUsage(supabase, store.id);
  const isOwner = role === "owner";

  const { data: team } = await supabase.rpc("workspace_team", { p_store_id: store.id });

  const { data: pending } = await supabase
    .from("workspace_invitations")
    .select("id, email, expires_at, status")
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: true });

  const seatsFull = usage ? usage.team.used >= usage.team.limit : true;
  const planAllowsTeam = usage ? usage.team.limit > 1 : false;
  const notice = usage && !planAllowsTeam ? quotaNotice("team", usage.planKey) : null;

  return (
    <DashboardShell
      storeName={store.name}
      storeSlug={store.slug}
      storeStatus={store.status}
      active="equipe"
      breadcrumbs={[{ label: "Configurações" }, { label: "Equipe" }]}
    >
      {usage && (
        <Card>
          <div className={styles.meter}>
            <QuotaMeter label="Usuários" used={usage.team.used} limit={usage.team.limit} />
          </div>
          <p className={styles.hint}>
            O limite é do seu plano e vale para a conta inteira — o proprietário conta dentro dele.
          </p>
        </Card>
      )}

      {/* Essencial: upsell, não erro. */}
      {notice ? (
        <Alert tone="info" title={notice.title}>
          <p className={styles.noticeBody}>{notice.body}</p>
          {notice.upgradeTo && (
            <a className={styles.upgradeLink} href={`/dashboard/assinatura?store=${store.slug}`}>
              Conhecer o {notice.upgradeTo.label}
            </a>
          )}
        </Alert>
      ) : (
        isOwner && (
          <Card>
            <h2 className={styles.sectionTitle}>Convidar pessoa</h2>
            <p className={styles.sectionHint}>
              Cada pessoa da equipe usa a própria conta e senha — nunca compartilhe o seu acesso.
            </p>
            {seatsFull ? (
              <Alert tone="warning">
                Todos os assentos do seu plano estão ocupados. Remova alguém ou faça upgrade para convidar mais
                pessoas.
              </Alert>
            ) : (
              <InviteForm disabled={false} />
            )}
          </Card>
        )
      )}

      <Card>
        <h2 className={styles.sectionTitle}>Pessoas com acesso</h2>
        <ul className={styles.list}>
          {(team ?? []).map((member) => (
            <li key={member.user_id} className={styles.item}>
              <div className={styles.itemMain}>
                <span className={styles.itemName}>
                  {member.display_name ?? member.email}
                  {member.is_self && <span className={styles.you}> (você)</span>}
                </span>
                <span className={styles.itemMeta}>{member.email}</span>
                <span className={styles.itemMeta}>Entrou em {formatDate(member.joined_at)}</span>
              </div>
              <div className={styles.itemActions}>
                <Badge tone={member.role === "owner" ? "info" : "neutral"}>
                  {member.role === "owner" ? "Proprietário" : "Membro"}
                </Badge>
                {isOwner && member.role !== "owner" && (
                  <RemoveMemberForm userId={member.user_id} name={member.display_name ?? member.email} />
                )}
              </div>
            </li>
          ))}
        </ul>
      </Card>

      {isOwner && (pending ?? []).length > 0 && (
        <Card>
          <h2 className={styles.sectionTitle}>Convites pendentes</h2>
          <p className={styles.sectionHint}>
            Convites pendentes já ocupam um assento. Cancelar libera a vaga na hora.
          </p>
          <ul className={styles.list}>
            {(pending ?? []).map((invite) => (
              <li key={invite.id} className={styles.item}>
                <div className={styles.itemMain}>
                  <span className={styles.itemName}>{invite.email}</span>
                  <span className={styles.itemMeta}>Expira em {formatDate(invite.expires_at)}</span>
                </div>
                <div className={styles.itemActions}>
                  <Badge tone="warning">Pendente</Badge>
                  <RevokeInviteForm invitationId={invite.id} />
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </DashboardShell>
  );
}
