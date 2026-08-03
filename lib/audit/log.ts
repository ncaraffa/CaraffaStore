import { createHash } from "node:crypto";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import type { AuditAction } from "@/lib/supabase/types";

/**
 * Identificador não reversível para usar como target_id de auditoria
 * quando o valor original (ex.: e-mail) não deveria ficar em texto
 * puro numa tabela de auditoria, mesmo uma sem policy de leitura para
 * anon/authenticated. Permite correlacionar solicitações repetidas para
 * o mesmo valor sem armazenar o valor em si.
 */
export function hashForAudit(value: string): string {
  return createHash("sha256").update(value.trim().toLowerCase()).digest("hex").slice(0, 32);
}

export interface AuditLogEntry {
  actorUserId?: string | null;
  action: AuditAction;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Auditoria de eventos de CONTA (cadastro, verificação, recuperação,
 * tentativa negada) — acontecem antes de existir loja/tenant, por isso
 * não passam pelas funções SQL SECURITY DEFINER de onboarding (essas só
 * cobrem os eventos atomicamente ligados à criação da loja: store_created/
 * owner_assigned/plan_selected/onboarding_completed).
 *
 * Usa o cliente service-role porque audit_log não tem NENHUMA policy de
 * insert para anon/authenticated por design (0002_auth_onboarding.sql) —
 * only server_role bypassa RLS aqui. SÓ pode ser importado por código
 * que roda no servidor (Server Actions/Route Handlers) — nunca por um
 * Client Component. `metadata` nunca deve conter senha, token, cookie
 * ou chave.
 */
export async function logAuditEvent(entry: AuditLogEntry): Promise<void> {
  try {
    const admin = createAdminSupabaseClient();
    await admin.from("audit_log").insert({
      actor_user_id: entry.actorUserId ?? null,
      store_id: null,
      action: entry.action,
      target_type: entry.targetType ?? null,
      target_id: entry.targetId ?? null,
      metadata: entry.metadata ?? {},
    });
  } catch {
    // Falha ao registrar auditoria nunca pode derrubar o fluxo principal
    // (cadastro/login/recuperação já concluído ou já respondido).
  }
}
