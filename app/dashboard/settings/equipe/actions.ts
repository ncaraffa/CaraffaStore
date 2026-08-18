"use server";

import { randomBytes, createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireStoreStatus } from "@/lib/tenant/access-control";

export interface TeamActionState {
  status: "idle" | "error" | "success";
  message?: string;
  fieldErrors?: Record<string, string>;
  /**
   * Link do convite, mostrado UMA vez ao owner logo depois de criar.
   * O token em claro só existe aqui e no que o owner copiar — o banco
   * guarda apenas o SHA-256.
   */
  inviteUrl?: string;
}

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email("Informe um e-mail válido."),
});

const MESSAGES: Record<string, string> = {
  max_team_members_reached: "Você atingiu o limite de usuários do seu plano.",
  already_member: "Esta pessoa já faz parte da sua equipe.",
  invitation_already_pending: "Já existe um convite pendente para este e-mail.",
  insufficient_privilege: "Apenas o proprietário pode gerenciar a equipe.",
  cannot_remove_owner: "O proprietário não pode ser removido.",
  member_not_found: "Membro não encontrado.",
  invitation_not_found: "Convite não encontrado.",
  subscription_not_found: "Não foi possível identificar sua assinatura.",
};

function messageFor(raw: string | undefined): string {
  if (!raw) return "Não foi possível concluir. Tente novamente.";
  const hit = Object.keys(MESSAGES).find((code) => raw.includes(code));
  return hit ? MESSAGES[hit]! : "Não foi possível concluir. Tente novamente.";
}

/**
 * Token de convite: 32 bytes de CSPRNG. O banco recebe SOMENTE o
 * SHA-256 — um vazamento da tabela não permite aceitar convite nenhum.
 */
function newInviteToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(token).digest("hex");
  return { token, hash };
}

export async function inviteMemberAction(
  _prev: TeamActionState,
  formData: FormData,
): Promise<TeamActionState> {
  const parsed = inviteSchema.safeParse({ email: String(formData.get("email") ?? "") });
  if (!parsed.success) {
    return { status: "error", fieldErrors: { email: parsed.error.issues[0]?.message ?? "E-mail inválido." } };
  }

  const supabase = await createServerSupabaseClient();
  const { store } = await requireStoreStatus(supabase, ["active"]);

  const { token, hash } = newInviteToken();

  // O limite de assentos NÃO é decidido aqui: workspace_invite_member
  // conta membros + convites pendentes válidos com o workspace travado.
  const { error } = await supabase.rpc("workspace_invite_member", {
    p_email: parsed.data.email,
    p_token_hash: hash,
  });

  if (error) {
    return { status: "error", message: messageFor(error.message) };
  }

  revalidatePath("/dashboard/settings/equipe");

  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "";
  return {
    status: "success",
    inviteUrl: `${site}/convite/${token}?store=${encodeURIComponent(store.slug)}`,
    message: `Convite criado para ${parsed.data.email}.`,
  };
}

export async function revokeInvitationAction(
  _prev: TeamActionState,
  formData: FormData,
): Promise<TeamActionState> {
  const supabase = await createServerSupabaseClient();
  await requireStoreStatus(supabase, ["active"]);

  const { error } = await supabase.rpc("workspace_revoke_invitation", {
    p_invitation_id: String(formData.get("invitationId") ?? ""),
  });

  if (error) return { status: "error", message: messageFor(error.message) };

  revalidatePath("/dashboard/settings/equipe");
  return { status: "success", message: "Convite cancelado. O assento voltou a ficar disponível." };
}

export async function removeMemberAction(
  _prev: TeamActionState,
  formData: FormData,
): Promise<TeamActionState> {
  const supabase = await createServerSupabaseClient();
  await requireStoreStatus(supabase, ["active"]);

  // Remove do workspace, tira o acesso a todas as lojas e revoga as
  // sessões — tudo na mesma transação, dentro da RPC.
  const { error } = await supabase.rpc("workspace_remove_member", {
    p_user_id: String(formData.get("userId") ?? ""),
  });

  if (error) return { status: "error", message: messageFor(error.message) };

  revalidatePath("/dashboard/settings/equipe");
  return { status: "success", message: "Membro removido. O acesso dele foi encerrado imediatamente." };
}
