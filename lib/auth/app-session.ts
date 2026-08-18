import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

type Client = SupabaseClient<Database>;

/**
 * Sessão da CaraffaStore — camada ADICIONAL de autorização sobre a
 * autenticação do Supabase.
 *
 * A identidade da sessão NÃO é inventada por nós: é o `session_id` que o
 * próprio access token do Supabase já carrega. O banco lê esse claim via
 * auth.jwt() e decide. Consequências que importam:
 *
 *   - abas do mesmo browser compartilham o token, logo compartilham a
 *     MESMA sessão (não consomem várias);
 *   - refresh de token preserva o session_id, logo renovar credencial
 *     não cria sessão nova;
 *   - revogar uma sessão tira autorização de QUALQUER requisição com
 *     aquele JWT — inclusive chamada direta ao PostgREST, sem passar por
 *     este arquivo.
 *
 * Nada aqui é a barreira de segurança. Estas funções servem para abrir a
 * sessão, manter o lease e mostrar o conflito ao usuário. Quem nega é o
 * banco (app_session_denied, consultada por is_store_member,
 * is_store_admin e can_manage_store_catalog).
 */

/** De quanto em quanto tempo o cliente renova o lease. Ver HEARTBEAT_RATIONALE. */
export const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Precisa ser MENOR que a janela de stale do banco
 * (`app_session_stale_window()` = 30 min). 5 min de batida contra 30 min
 * de tolerância dá margem para SEIS falhas seguidas antes de a sessão
 * ser considerada abandonada — o suficiente para notebook suspenso,
 * celular em background, queda de rede e o throttling que os browsers
 * aplicam a abas ocultas. Mudar um exige revisar o outro.
 */
export const STALE_WINDOW_MINUTES = 30;

export interface SessionConflict {
  /** Rótulo legível da outra sessão ("Chrome (PC)"), nunca identificador de hardware. */
  otherLabel: string | null;
  otherLastSeen: string | null;
}

export type StartSessionResult =
  | { status: "active"; sessionId: string }
  | { status: "conflict"; conflict: SessionConflict }
  /**
   * A sessão deste browser foi revogada por decisão (takeover, logout em
   * outro lugar, remoção da equipe, downgrade de plano). NÃO ressuscita:
   * exige autenticação nova. Ver 0023.
   */
  | { status: "revoked" }
  | { status: "error"; code: string };

/**
 * Abre ou renova a sessão do browser atual. Idempotente: chamar em toda
 * navegação é barato e nunca cria linha nova para o mesmo browser.
 *
 * `takeover` só deve ser true quando o usuário escolheu explicitamente
 * "encerrar a outra sessão e entrar aqui".
 */
export async function startAppSession(
  supabase: Client,
  params: { workspaceId: string; userAgentLabel?: string | null; takeover?: boolean },
): Promise<StartSessionResult> {
  const { data, error } = await supabase.rpc("app_session_start", {
    p_workspace_id: params.workspaceId,
    p_user_agent_label: params.userAgentLabel ?? null,
    p_takeover: params.takeover ?? false,
  });

  if (error) {
    const code = extractCode(error.message);
    return code === "session_revoked" ? { status: "revoked" } : { status: "error", code };
  }

  const row = data?.[0];
  if (!row) return { status: "error", code: "unknown_error" };

  if (row.conflict) {
    return {
      status: "conflict",
      conflict: { otherLabel: row.other_label, otherLastSeen: row.other_last_seen },
    };
  }

  return { status: "active", sessionId: row.session_id ?? "" };
}

/**
 * Mesma coisa, mas a partir da LOJA — o banco resolve o workspace.
 *
 * É a variante usada no bootstrap de requireStoreStatus, que roda em
 * toda requisição administrativa: uma chamada só, sem um SELECT extra
 * para descobrir o workspace antes.
 */
export async function startAppSessionForStore(
  supabase: Client,
  params: { storeId: string; userAgentLabel?: string | null; takeover?: boolean },
): Promise<StartSessionResult> {
  const { data, error } = await supabase.rpc("app_session_start_for_store", {
    p_store_id: params.storeId,
    p_user_agent_label: params.userAgentLabel ?? null,
    p_takeover: params.takeover ?? false,
  });

  if (error) {
    const code = extractCode(error.message);
    return code === "session_revoked" ? { status: "revoked" } : { status: "error", code };
  }

  const row = data?.[0];
  if (!row) return { status: "error", code: "unknown_error" };

  if (row.conflict) {
    return {
      status: "conflict",
      conflict: { otherLabel: row.other_label, otherLastSeen: row.other_last_seen },
    };
  }
  return { status: "active", sessionId: row.session_id ?? "" };
}

/**
 * Renova o lease. `false` significa que esta sessão não vale mais (foi
 * revogada por takeover, logout, remoção de membro ou downgrade) — o
 * cliente deve encerrar e voltar ao login.
 *
 * Ignorar este retorno não concede nada: as mutations continuam sendo
 * recusadas pelo banco.
 */
export async function heartbeatAppSession(supabase: Client): Promise<boolean> {
  const { data, error } = await supabase.rpc("app_session_heartbeat");
  if (error) return false;
  return data === true;
}

/** Revoga a sessão atual imediatamente. Chamado no logout, antes do signOut. */
export async function endAppSession(supabase: Client): Promise<void> {
  await supabase.rpc("app_session_logout");
}

/**
 * Rótulo curto e legível do browser, derivado só do User-Agent que o
 * navegador já envia em toda requisição.
 *
 * Deliberadamente grosseiro: serve para o dono reconhecer "ah, é o meu
 * celular" na hora de decidir o takeover. NÃO é fingerprint — não
 * identifica hardware, não persiste nada além deste rótulo, e duas
 * pessoas com o mesmo browser produzem o mesmo texto. A garantia do
 * plano é sobre CONCORRÊNCIA de sessão, não sobre identificar quem está
 * do outro lado.
 */
export function browserLabel(userAgent: string | null | undefined): string {
  if (!userAgent) return "Dispositivo desconhecido";

  const browser =
    /Edg\//.test(userAgent) ? "Edge"
    : /OPR\/|Opera/.test(userAgent) ? "Opera"
    : /Chrome\//.test(userAgent) ? "Chrome"
    : /Safari\//.test(userAgent) ? "Safari"
    : /Firefox\//.test(userAgent) ? "Firefox"
    : "Navegador";

  const platform =
    /Android/.test(userAgent) ? "Android"
    : /iPhone|iPad|iPod/.test(userAgent) ? "iPhone/iPad"
    : /Windows/.test(userAgent) ? "Windows"
    : /Mac OS X/.test(userAgent) ? "Mac"
    : /Linux/.test(userAgent) ? "Linux"
    : null;

  return platform ? `${browser} (${platform})` : browser;
}

const KNOWN_CODES = [
  "session_revoked",
  "auth_required",
  "insufficient_privilege",
  "workspace_not_found",
  "subscription_not_found",
];

function extractCode(message: string | undefined): string {
  if (!message) return "unknown_error";
  return KNOWN_CODES.find((code) => message.includes(code)) ?? "unknown_error";
}
