import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guarda de regressão por análise estática. Cobre a correção do
 * BUG-T2-004 (qa/reports/TASK-002.md): audit_log precisa ser
 * append-only de verdade (nem service_role altera/apaga), e as duas
 * funções de auditoria de conta não podem aceitar ator vindo do
 * cliente.
 */

const migrationPath = path.resolve(import.meta.dirname, "0004_account_audit.sql");
const raw = readFileSync(migrationPath, "utf8").replace(/\r\n/g, "\n").toLowerCase();
const sql = raw
  .split("\n")
  .map((line) => line.replace(/--.*$/, ""))
  .join("\n");

describe("supabase/migrations/0004_account_audit.sql — auditoria append-only e sem service role em fluxo de usuário", () => {
  it("revoga UPDATE/DELETE de service_role em audit_log — append-only para TODOS os papéis, inclusive admin", () => {
    expect(sql).toContain("revoke update, delete on public.audit_log from service_role");
  });

  it("action check constraint não inclui mais signup_completed nem password_recovery_requested (cobertos por auth.audit_log_entries do GoTrue)", () => {
    expect(sql).not.toMatch(/'signup_completed'/);
    expect(sql).not.toMatch(/'password_recovery_requested'/);
    expect(sql).toContain("'email_verification_completed'");
    expect(sql).toContain("'password_recovery_completed'");
  });

  it("log_email_verification_completed() e log_password_recovery_completed() não recebem NENHUM parâmetro (sem ator/tenant forjável)", () => {
    expect(sql).toContain("create or replace function public.log_email_verification_completed()");
    expect(sql).toContain("create or replace function public.log_password_recovery_completed()");
  });

  it("as duas funções usam auth.uid() como único ator, nunca um parâmetro do cliente", () => {
    expect(sql).toContain("v_uid uuid := auth.uid()");
    // aparece 2x, uma vez em cada função
    const occurrences = sql.match(/v_uid uuid := auth\.uid\(\)/g) ?? [];
    expect(occurrences.length).toBe(2);
  });

  it("SECURITY DEFINER com search_path vazio nas duas funções novas", () => {
    const definerClauses =
      sql.match(/language plpgsql\s*\nsecurity definer\s*\nset search_path = ''/g) ?? [];
    expect(definerClauses.length).toBe(2);
  });

  it("EXECUTE concedido só a authenticated, nunca a anon", () => {
    expect(sql).toContain(
      "grant execute on function public.log_email_verification_completed() to authenticated",
    );
    expect(sql).toContain(
      "grant execute on function public.log_password_recovery_completed() to authenticated",
    );
    const grantLines = sql.split(";").filter((stmt) => /^\s*grant execute\s/.test(stmt.trimStart()));
    const anonGrant = grantLines.find((stmt) => /\bto\b[^;]*\banon\b/.test(stmt));
    expect(anonGrant).toBeUndefined();
  });
});
