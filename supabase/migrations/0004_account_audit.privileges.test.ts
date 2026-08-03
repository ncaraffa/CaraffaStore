import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guarda de regressão por análise estática. Cobre a segunda correção
 * pós-QA (qa/reports/TASK-002-RETEST.md): audit_log continua
 * append-only de verdade (nem service_role altera/apaga), o
 * bloqueador 6 (migração quebra sobre dados históricos da 0002) e a
 * ressalva de append-only (ON DELETE RESTRICT em vez de SET NULL).
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
