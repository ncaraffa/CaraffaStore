import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guarda de regressão por análise estática para
 * supabase/migrations/0003_recovery_session.sql — a terceira reescrita
 * do mecanismo de prova de finalidade, depois da revisão externa sobre
 * qa/reports/TASK-002-CLAUDE-VERIFICATION.md (BUG-CLAUDE-001/002/003).
 * Cobre especificamente:
 *
 *   - BUG-CLAUDE-001: emissão do grant de recuperação só por
 *     service_role, nunca por RPC pública; claim exige nonce + session_id
 *     + user_id simultaneamente.
 *   - BUG-CLAUDE-003: nenhuma RPC de "pedir recuperação" concede EXECUTE
 *     a anon/authenticated (a antiga request_password_recovery_grant foi
 *     removida por completo).
 *   - O desenho antigo (auth_flow_grants, consume_auth_flow_grant,
 *     handle_new_user_confirmation_grant) é explicitamente DROPADO, não
 *     só deixado de lado.
 */

const migrationPath = path.resolve(import.meta.dirname, "0003_recovery_session.sql");
const raw = readFileSync(migrationPath, "utf8").replace(/\r\n/g, "\n").toLowerCase();
const sql = raw
  .split("\n")
  .map((line) => line.replace(/--.*$/, ""))
  .join("\n");

describe("supabase/migrations/0003_recovery_session.sql — desenho antigo (auth_flow_grants) removido por completo", () => {
  it("dropa o trigger/função de confirmação automática, request/consume da versão anterior e a tabela auth_flow_grants", () => {
    expect(sql).toContain("drop trigger if exists on_auth_user_created_confirmation_grant on auth.users");
    expect(sql).toContain("drop function if exists public.handle_new_user_confirmation_grant()");
    expect(sql).toContain("drop function if exists public.request_password_recovery_grant(text)");
    expect(sql).toContain("drop function if exists public.consume_auth_flow_grant(text)");
    expect(sql).toContain("drop table if exists public.auth_flow_grants");
  });

  it("dropa explicitamente a assinatura antiga (zero parâmetros) de claim_recovery_grant_for_password_change — nenhum overload órfão sobrevive", () => {
    expect(sql).toContain("drop function if exists public.claim_recovery_grant_for_password_change()");
  });

  it("nenhuma RPC de emissão/consumo do desenho antigo (request_password_recovery_grant/consume_auth_flow_grant) é recriada nesta migração", () => {
    expect(sql).not.toMatch(/create or replace function public\.request_password_recovery_grant/);
    expect(sql).not.toMatch(/create or replace function public\.consume_auth_flow_grant/);
    expect(sql).not.toMatch(/create or replace function public\.handle_new_user_confirmation_grant/);
  });
});

describe("supabase/migrations/0003_recovery_session.sql — password_recovery_grants sem nenhum grant de tabela para cliente", () => {
  it("revoga TUDO de public/anon/authenticated/service_role antes de conceder de volta", () => {
    expect(sql).toContain(
      "revoke all on public.password_recovery_grants from public, anon, authenticated, service_role",
    );
  });

  it("nenhum GRANT de tabela para anon nem authenticated", () => {
    const grantLines = sql.split(";").filter((stmt) => /^\s*grant\s+(select|insert|update|delete)/.test(stmt.trimStart()));
    const clientGrant = grantLines.find(
      (stmt) =>
        /\bon\s+public\.password_recovery_grants\b/.test(stmt) &&
        (/\bto\b[^;]*\banon\b/.test(stmt) || /\bto\b[^;]*\bauthenticated\b/.test(stmt)),
    );
    expect(clientGrant).toBeUndefined();
  });

  it("só service_role recebe grant de tabela (uso administrativo)", () => {
    expect(sql).toContain("grant select, insert, update, delete on public.password_recovery_grants to service_role");
  });

  it("RLS habilitada, sem nenhuma policy criada", () => {
    expect(sql).toContain("alter table public.password_recovery_grants enable row level security");
    expect(sql).not.toMatch(/create policy[^;]*password_recovery_grants/);
  });

  it("expires_at/session_id são NOT NULL; um grant por usuário (unique) — já garante no máximo um grant claimed-não-concluído por usuário sem precisar de índice único parcial adicional", () => {
    expect(sql).toMatch(/expires_at timestamptz not null/);
    expect(sql).toContain("session_id uuid not null");
    expect(sql).toContain("constraint password_recovery_grants_user_unique unique (user_id)");
  });

  it("nonce_hash é NULLABLE (limpo no claim — BUG-CLAUDE-VERIF2-001) mas tem constraint de formato quando presente (hex sha256, nunca o nonce em texto puro)", () => {
    expect(sql).toContain("nonce_hash text,");
    expect(sql).not.toMatch(/nonce_hash text not null/);
    expect(sql).toMatch(/constraint password_recovery_grants_nonce_hash_format check \(nonce_hash is null or nonce_hash ~/);
  });

  it("máquina de estados: claimed_at/completed_at/revoked_at existem como colunas nullable de timestamp", () => {
    expect(sql).toContain("claimed_at timestamptz,");
    expect(sql).toContain("completed_at timestamptz,");
    expect(sql).toContain("revoked_at timestamptz,");
  });
});

describe("emissão — requisito BUG-CLAUDE-001/003: só service_role emite, nenhuma RPC pública de 'pedir recuperação'", () => {
  it("issue_password_recovery_grant aceita user_id/session_id/nonce/ttl — mas EXECUTE é só para service_role", () => {
    expect(sql).toContain(
      "create or replace function public.issue_password_recovery_grant(\n  p_user_id uuid,\n  p_session_id uuid,\n  p_nonce text,\n  p_ttl_seconds integer default 1800\n)",
    );
    expect(sql).toContain(
      "grant execute on function public.issue_password_recovery_grant(uuid, uuid, text, integer) to service_role",
    );
  });

  it("EXECUTE de issue_password_recovery_grant NUNCA concedido a anon/authenticated/PUBLIC", () => {
    const grantLines = sql.split(";").filter((stmt) => /^\s*grant execute\s/.test(stmt.trimStart()));
    const clientGrant = grantLines.find(
      (stmt) =>
        /\bissue_password_recovery_grant\b/.test(stmt) &&
        (/\bto\b[^;]*\banon\b/.test(stmt) || /\bto\b[^;]*\bauthenticated\b/.test(stmt) || /\bto\b[^;]*\bpublic\b/.test(stmt)),
    );
    expect(clientGrant).toBeUndefined();
  });

  it("issue_password_recovery_grant valida ttl_seconds defensivamente (nunca aceita um valor absurdo, mesmo do próprio código server-side)", () => {
    expect(sql).toMatch(/p_ttl_seconds is null or p_ttl_seconds <= 0 or p_ttl_seconds > 3600/);
  });

  it("hash do nonce gravado via extensions.digest(..., 'sha256') — nunca o nonce em texto puro", () => {
    expect(sql).toMatch(/encode\(extensions\.digest\(p_nonce, 'sha256'\), 'hex'\)/);
  });

  it("nenhuma RPC pública equivalente a 'request_password_recovery_grant' existe nesta migração (BUG-CLAUDE-003)", () => {
    expect(sql).not.toMatch(/create or replace function public\.request_password_recovery_grant/);
  });
});

describe("reivindicação/leitura — requisito BUG-CLAUDE-001: nonce + session_id + user_id simultâneos, nunca vindos livremente do cliente", () => {
  it("claim_recovery_grant_for_password_change aceita p_nonce — usa auth.uid()/auth.jwt() internamente para user_id/session_id, nunca um id vindo do cliente", () => {
    expect(sql).toContain("create or replace function public.claim_recovery_grant_for_password_change(p_nonce text)");
    expect(sql).not.toMatch(/claim_recovery_grant_for_password_change\([^)]*user_id/);
    expect(sql).not.toMatch(/claim_recovery_grant_for_password_change\([^)]*session_id/);
    expect(sql).toContain("v_uid uuid := auth.uid()");
    expect(sql).toContain("v_session_id uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid");
  });

  it("claim exige nonce_hash correto no WHERE do UPDATE — sem ele, uma sessão com grant pendente de verdade ainda não reivindica nada", () => {
    expect(sql).toMatch(/and nonce_hash = encode\(extensions\.digest\(p_nonce, 'sha256'\), 'hex'\)/);
  });

  it("claim exige claimed_at/completed_at/revoked_at todos null no WHERE — não reivindica um grant já claimed, completed ou revoked", () => {
    const claimFn = sql.slice(
      sql.indexOf("create or replace function public.claim_recovery_grant_for_password_change"),
      sql.indexOf("comment on function public.claim_recovery_grant_for_password_change"),
    );
    expect(claimFn).toMatch(/and claimed_at is null/);
    expect(claimFn).toMatch(/and completed_at is null/);
    expect(claimFn).toMatch(/and revoked_at is null/);
  });

  it("BUG-CLAUDE-VERIF2-001: claim NUNCA grava password_recovery_completed — só password_recovery_authorization_claimed", () => {
    const claimFn = sql.slice(
      sql.indexOf("create or replace function public.claim_recovery_grant_for_password_change"),
      sql.indexOf("comment on function public.claim_recovery_grant_for_password_change"),
    );
    expect(claimFn).toContain("password_recovery_authorization_claimed");
    expect(claimFn).not.toContain("'password_recovery_completed'");
  });

  it("is_current_session_recovery_grant não aceita NENHUM parâmetro", () => {
    expect(sql).toContain("create or replace function public.is_current_session_recovery_grant()\nreturns boolean");
  });

  it("EXECUTE de claim/is_current_session só para authenticated, nunca anon nem PUBLIC", () => {
    for (const fn of ["claim_recovery_grant_for_password_change(text)", "is_current_session_recovery_grant()"]) {
      const escaped = fn.replace(/[()]/g, (c) => `\\${c}`);
      expect(sql).toMatch(new RegExp(`grant execute on function public\\.${escaped} to authenticated`));
    }
    const grantLines = sql.split(";").filter((stmt) => /^\s*grant execute\s/.test(stmt.trimStart()));
    const anonGrant = grantLines.find(
      (stmt) =>
        /\b(claim_recovery_grant_for_password_change|is_current_session_recovery_grant)\b/.test(stmt) &&
        /\bto\b[^;]*\banon\b/.test(stmt),
    );
    expect(anonGrant).toBeUndefined();
  });

  it("todas as funções novas revogam de PUBLIC antes de conceder (EXECUTE não fica implícito a PUBLIC)", () => {
    const occurrences = sql.match(/revoke all on function[^;]*from public/g) ?? [];
    // issue_password_recovery_grant, claim_recovery_grant_for_password_change,
    // is_current_session_recovery_grant = 3 funções nesta migração
    // (handle_email_confirmed_audit vive em 0004_account_audit.sql).
    expect(occurrences.length).toBe(3);
  });
});

describe("atomicidade — UPDATE único (pending -> claimed), sem consultar-depois-agir, auditoria dentro da mesma transação", () => {
  it("claim_recovery_grant_for_password_change faz um UPDATE condicional único (set claimed_at/nonce_hash) — sem SELECT prévio separado, e NÃO apaga a linha (precisa sobreviver para a trigger de conclusão correlacionar depois)", () => {
    expect(sql).toContain("update public.password_recovery_grants");
    expect(sql).toContain("set claimed_at = now(),\n      nonce_hash = null");
    const claimFn = sql.slice(
      sql.indexOf("create or replace function public.claim_recovery_grant_for_password_change"),
      sql.indexOf("comment on function public.claim_recovery_grant_for_password_change"),
    );
    expect(claimFn).not.toContain("delete from");
  });

  it("auditoria é inserida DENTRO da mesma função (sem exception handler ao redor) — falha no insert derruba a função inteira", () => {
    const claimFn = sql.slice(
      sql.indexOf("create or replace function public.claim_recovery_grant_for_password_change"),
      sql.indexOf("create or replace function public.is_current_session_recovery_grant"),
    );
    expect(claimFn).toContain("insert into public.audit_log");
    expect(claimFn).not.toContain("exception when");
  });
});

describe("SECURITY DEFINER com search_path vazio em todas as funções novas desta migração", () => {
  it("3 funções (issue/claim/is_current_session), todas security definer com search_path vazio", () => {
    const occurrences = sql.match(/security definer\s*\nset search_path = ''/g) ?? [];
    expect(occurrences.length).toBe(3);
  });
});
