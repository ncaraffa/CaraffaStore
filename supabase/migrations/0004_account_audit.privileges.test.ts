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

  it("NÃO toca em audit_log_action_check — a 0002 já permite os valores necessários; estreitar quebraria upgrade com dados históricos (bloqueador 6, BUG-RT2-006)", () => {
    expect(sql).not.toContain("drop constraint audit_log_action_check");
    expect(sql).not.toContain("add constraint audit_log_action_check");
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
