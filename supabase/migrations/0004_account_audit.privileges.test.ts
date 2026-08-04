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
 * qa/reports/TASK-002-CLAUDE-VERIFICATION-2.md, BUG-CLAUDE-VERIF2-001):
 * audit_log_action_check agora É alterado aqui (diferente da correção
 * anterior, que deliberadamente não tocava nele) — mas só para
 * ALARGAR o conjunto permitido (adicionar
 * password_recovery_authorization_claimed), nunca para estreitá-lo;
 * password_recovery_completed passa a ser gravado exclusivamente pela
 * nova trigger on_auth_user_password_changed, correlacionada a uma
 * transição real em auth.users.encrypted_password.
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

  it("ALARGA audit_log_action_check (nunca estreita): todos os valores antigos permanecem, password_recovery_authorization_claimed é adicionado (BUG-CLAUDE-VERIF2-001)", () => {
    const constraintStmt = sql.slice(
      sql.indexOf("alter table public.audit_log\n  drop constraint audit_log_action_check"),
      sql.indexOf("comment on constraint audit_log_action_check"),
    );
    for (const action of [
      "signup_completed",
      "email_verification_completed",
      "password_recovery_requested",
      "password_recovery_authorization_claimed",
      "password_recovery_completed",
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

describe("handle_password_recovery_completion — password_recovery_completed nasce de uma transição real em auth.users, não do claim (BUG-CLAUDE-VERIF2-001)", () => {
  it("função security definer, search_path vazio, revogada de PUBLIC — nenhum GRANT de EXECUTE para nenhum papel (só o próprio trigger a invoca)", () => {
    expect(sql).toContain("create or replace function public.handle_password_recovery_completion()");
    const fnBody = sql.slice(
      sql.indexOf("create or replace function public.handle_password_recovery_completion()"),
      sql.indexOf("comment on function public.handle_password_recovery_completion"),
    );
    expect(fnBody).toMatch(/security definer\s*\nset search_path = ''/);
    expect(sql).toContain("revoke all on function public.handle_password_recovery_completion() from public");
    expect(sql).not.toMatch(/grant execute[^;]*handle_password_recovery_completion/);
  });

  it("só marca completed_at/grava password_recovery_completed quando existe exatamente um grant claimed (não completed, não revoked) para new.id — nunca fabrica conclusão sem uma autorização reivindicada", () => {
    const fnBody = sql.slice(
      sql.indexOf("create or replace function public.handle_password_recovery_completion()"),
      sql.indexOf("comment on function public.handle_password_recovery_completion"),
    );
    expect(fnBody).toContain("where user_id = new.id");
    expect(fnBody).toContain("and claimed_at is not null");
    expect(fnBody).toContain("and completed_at is null");
    expect(fnBody).toContain("and revoked_at is null");
    expect(fnBody).toMatch(/if v_grant_id is not null then/);
    expect(fnBody).toContain("'password_recovery_completed'");
  });

  it("trigger dispara em AFTER UPDATE OF encrypted_password em auth.users, só quando o hash realmente muda (WHEN) — nunca em qualquer UPDATE de auth.users", () => {
    expect(sql).toContain("after update of encrypted_password on auth.users");
    expect(sql).toContain("when (old.encrypted_password is distinct from new.encrypted_password)");
    expect(sql).toContain("execute function public.handle_password_recovery_completion()");
  });

  it("auditoria de conclusão é gravada DENTRO da mesma função/transação da trigger (sem exception handler ao redor) — falha no insert propaga e desfaz a troca de senha inteira", () => {
    const fnBody = sql.slice(
      sql.indexOf("create or replace function public.handle_password_recovery_completion()"),
      sql.indexOf("comment on function public.handle_password_recovery_completion"),
    );
    expect(fnBody).not.toContain("exception when");
  });
});
