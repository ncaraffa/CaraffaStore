import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guarda de regressão por análise estática. Cobre a segunda correção
 * pós-QA (qa/reports/TASK-002-RETEST.md): audit_log continua
 * append-only de verdade (nem service_role altera/apaga), o
 * bloqueador 6 (migração quebra sobre dados históricos da 0002) e a
 * ressalva de append-only (ON DELETE RESTRICT em vez de SET NULL).
 *
 * Também cobre a terceira correção pós-QA (revisão externa sobre
 * qa/reports/TASK-002-CLAUDE-VERIFICATION.md, BUG-CLAUDE-002): o evento
 * email_verification_completed passa a nascer de um TRIGGER em
 * auth.users (transição real de email_confirmed_at), nunca de uma RPC
 * chamável por um cliente.
 *
 * Também cobre a quarta correção pós-QA (revisão externa sobre
 * qa/reports/TASK-002-CLAUDE-VERIFICATION-2.md, BUG-CLAUDE-VERIF2-001,
 * histórico — substituída pela quinta correção abaixo): a trigger
 * automática que concluía o grant foi removida na quinta correção.
 *
 * Também cobre a QUINTA correção pós-QA (revisão externa sobre
 * qa/reports/TASK-002-CLAUDE-VERIFICATION-3.md, BUG-CLAUDE-VERIF3-001):
 * a trigger on_auth_user_password_changed/handle_password_recovery_completion
 * (que correlacionava só por user_id, sem expires_at/session_id/janela
 * temporal — fabricável) é REMOVIDA por completo. A conclusão passa a
 * ser complete_password_recovery_attempt(attempt_id, capability) —
 * EXECUTE só para service_role, exige attempt_id + capability exatos e
 * prova de que a credencial realmente mudou (fingerprint). audit_log_action_check
 * ganha password_recovery_grant_issued/password_recovery_revoked (só
 * ALARGA, nunca estreita).
 */

const migrationPath = path.resolve(import.meta.dirname, "0004_account_audit.sql");
const raw = readFileSync(migrationPath, "utf8").replace(/\r\n/g, "\n").toLowerCase();
const sql = raw
  .split("\n")
  .map((line) => line.replace(/--.*$/, ""))
  .join("\n");

describe("supabase/migrations/0004_account_audit.sql — append-only e compatível com upgrade da 0002", () => {
  it("revoga UPDATE/DELETE de service_role em audit_log — append-only para TODOS os papéis, inclusive admin", () => {
    expect(sql).toContain("revoke update, delete on public.audit_log from service_role");
  });

  it("ALARGA audit_log_action_check (nunca estreita): todos os valores antigos permanecem, password_recovery_grant_issued/password_recovery_revoked são adicionados (BUG-CLAUDE-VERIF3-001)", () => {
    const constraintStmt = sql.slice(
      sql.indexOf("alter table public.audit_log\n  drop constraint audit_log_action_check"),
      sql.indexOf("comment on constraint audit_log_action_check"),
    );
    for (const action of [
      "signup_completed",
      "email_verification_completed",
      "password_recovery_requested",
      "password_recovery_grant_issued",
      "password_recovery_authorization_claimed",
      "password_recovery_completed",
      "password_recovery_revoked",
      "store_created",
      "owner_assigned",
      "plan_selected",
      "onboarding_completed",
      "access_denied",
    ]) {
      expect(constraintStmt).toContain(`'${action}'`);
    }
  });

  it("store_id passa a ON DELETE RESTRICT (não mais SET NULL) — exclusão de loja não pode alterar evento histórico (RESSALVA-RT2-001)", () => {
    expect(sql).toContain("drop constraint audit_log_store_id_fkey");
    expect(sql).toContain("on delete restrict");
    expect(sql).not.toContain("on delete set null");
  });

  it("log_email_verification_completed()/log_password_recovery_completed() são removidas — auditoria passou a viver dentro das funções atômicas de 0003 (BUG-RT2-005)", () => {
    expect(sql).toContain("drop function if exists public.log_email_verification_completed()");
    expect(sql).toContain("drop function if exists public.log_password_recovery_completed()");
  });
});

describe("handle_email_confirmed_audit — evento de confirmação nasce de uma transição real, não de uma RPC (BUG-CLAUDE-002)", () => {
  it("função security definer, search_path vazio, revogada de PUBLIC — nenhum GRANT de EXECUTE para nenhum papel (só o próprio trigger a invoca)", () => {
    expect(sql).toContain("create or replace function public.handle_email_confirmed_audit()");
    expect(sql).toMatch(/security definer\s*\nset search_path = ''/);
    expect(sql).toContain("revoke all on function public.handle_email_confirmed_audit() from public");
    expect(sql).not.toMatch(/grant execute[^;]*handle_email_confirmed_audit/);
  });

  it("insere email_verification_completed usando new.id — nenhum parâmetro de cliente envolvido", () => {
    expect(sql).toMatch(/insert into public\.audit_log[\s\S]*?values \(new\.id, null, 'email_verification_completed'/);
  });

  it("trigger dispara em AFTER UPDATE em auth.users, só na transição email_confirmed_at null -> not null (WHEN) — nunca em qualquer UPDATE", () => {
    expect(sql).toContain("after update on auth.users");
    expect(sql).toContain("when (old.email_confirmed_at is null and new.email_confirmed_at is not null)");
    expect(sql).toContain("execute function public.handle_email_confirmed_audit()");
  });

  it("nenhuma RPC pública equivalente a 'registrar confirmação' existe nesta migração (ex.: consume_auth_flow_grant/log_email_verification_completed não são recriadas)", () => {
    expect(sql).not.toMatch(/create or replace function public\.consume_auth_flow_grant/);
    expect(sql).not.toMatch(/create or replace function public\.log_email_verification_completed/);
  });
});

describe("handle_password_recovery_completion/on_auth_user_password_changed removidos por completo — BUG-CLAUDE-VERIF3-001", () => {
  it("dropa o trigger e a função da correção anterior — nenhum mecanismo automático sobre auth.users conclui um grant por conta própria", () => {
    expect(sql).toContain("drop trigger if exists on_auth_user_password_changed on auth.users");
    expect(sql).toContain("drop function if exists public.handle_password_recovery_completion()");
    expect(sql).not.toMatch(/create or replace function public\.handle_password_recovery_completion/);
    expect(sql).not.toContain("after update of encrypted_password on auth.users");
  });
});

describe("complete_password_recovery_attempt — conclusão EXPLÍCITA, server-only, causalmente vinculada à tentativa exata (BUG-CLAUDE-VERIF3-001)", () => {
  it("função security definer, search_path vazio, revogada de PUBLIC — EXECUTE só para service_role (nem anon, nem authenticated, nem PUBLIC)", () => {
    expect(sql).toMatch(
      /create or replace function public\.complete_password_recovery_attempt\(\n {2}p_attempt_id uuid,\n {2}p_capability text\n\)\nreturns boolean/,
    );
    const fnBody = sql.slice(
      sql.indexOf("create or replace function public.complete_password_recovery_attempt"),
      sql.indexOf("comment on function public.complete_password_recovery_attempt"),
    );
    expect(fnBody).toMatch(/security definer\s*\nset search_path = ''/);
    expect(sql).toContain("revoke all on function public.complete_password_recovery_attempt(uuid, text) from public");
    expect(sql).toContain("grant execute on function public.complete_password_recovery_attempt(uuid, text) to service_role");
    const grantLines = sql.split(";").filter((stmt) => /^\s*grant execute\s/.test(stmt.trimStart()));
    const clientGrant = grantLines.find(
      (stmt) =>
        /\bcomplete_password_recovery_attempt\b/.test(stmt) &&
        (/\bto\b[^;]*\banon\b/.test(stmt) || /\bto\b[^;]*\bauthenticated\b/.test(stmt)),
    );
    expect(clientGrant).toBeUndefined();
  });

  it("exige attempt_id + capability (por hash) + claimed/não completed/não revoked + dentro da janela claim_expires_at — nunca correlaciona por user_id sozinho", () => {
    const fnBody = sql.slice(
      sql.indexOf("create or replace function public.complete_password_recovery_attempt"),
      sql.indexOf("comment on function public.complete_password_recovery_attempt"),
    );
    expect(fnBody).toContain("where id = p_attempt_id");
    expect(fnBody).toContain("and completion_secret_hash = encode(extensions.digest(p_capability, 'sha256'), 'hex')");
    expect(fnBody).toContain("and claimed_at is not null");
    expect(fnBody).toContain("and completed_at is null");
    expect(fnBody).toContain("and revoked_at is null");
    expect(fnBody).toContain("and claim_expires_at > now()");
    expect(fnBody).not.toContain("where user_id = new.id");
  });

  it("exige que o fingerprint ATUAL da credencial seja DIFERENTE do capturado no claim — recusa concluir sem alteração real (\"PROVA DE ALTERAÇÃO REAL\")", () => {
    const fnBody = sql.slice(
      sql.indexOf("create or replace function public.complete_password_recovery_attempt"),
      sql.indexOf("comment on function public.complete_password_recovery_attempt"),
    );
    expect(fnBody).toContain("if v_current_fingerprint = v_fingerprint_before then");
    expect(fnBody).toContain("return false;");
  });

  it("só marca completed_at/grava password_recovery_completed depois de todas as validações passarem, com attempt_id em metadata", () => {
    const fnBody = sql.slice(
      sql.indexOf("create or replace function public.complete_password_recovery_attempt"),
      sql.indexOf("comment on function public.complete_password_recovery_attempt"),
    );
    expect(fnBody).toContain("set completed_at = now(),\n      completion_secret_hash = null");
    expect(fnBody).toContain("'password_recovery_completed'");
    expect(fnBody).toContain("jsonb_build_object('attempt_id', p_attempt_id)");
  });

  it("auditoria de conclusão é gravada DENTRO da mesma função/transação (sem exception handler ao redor) — falha no insert propaga e desfaz o UPDATE de completed_at junto", () => {
    const fnBody = sql.slice(
      sql.indexOf("create or replace function public.complete_password_recovery_attempt"),
      sql.indexOf("comment on function public.complete_password_recovery_attempt"),
    );
    expect(fnBody).not.toContain("exception when");
  });

  it("security definer com search_path vazio (junto de handle_email_confirmed_audit — 2 funções nesta migração)", () => {
    const occurrences = sql.match(/security definer\s*\nset search_path = ''/g) ?? [];
    expect(occurrences.length).toBe(2);
  });
});
