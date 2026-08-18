"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { startAppSession, browserLabel } from "@/lib/auth/app-session";

export interface TakeoverState {
  status: "idle" | "error";
  message?: string;
}

/**
 * "Encerrar a outra sessão e entrar aqui".
 *
 * Exige autenticação válida (o JWT desta requisição) e faz o takeover no
 * banco, numa transação: a outra sessão é revogada e esta assume, sem
 * janela em que as duas fiquem ativas. O usuário legítimo nunca precisa
 * esperar o lease vencer.
 *
 * A loja NUNCA vem do formulário — é resolvida do lado do servidor a
 * partir da sessão, então postar esta action com outro `store` não muda
 * de workspace.
 */
export async function takeoverSessionAction(
  _prev: TakeoverState,
  formData: FormData,
): Promise<TakeoverState> {
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  // Workspace derivado da associação real do usuário, nunca de parâmetro.
  const { data: membership } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!membership?.workspace_id) {
    return { status: "error", message: "Não foi possível identificar sua conta." };
  }

  const headerList = await headers();
  const result = await startAppSession(supabase, {
    workspaceId: membership.workspace_id,
    userAgentLabel: browserLabel(headerList.get("user-agent")),
    takeover: true,
  });

  if (result.status === "error") {
    return { status: "error", message: "Não foi possível entrar agora. Tente novamente." };
  }

  const slug = String(formData.get("store") ?? "");
  redirect(slug ? `/dashboard?store=${encodeURIComponent(slug)}` : "/dashboard");
}
