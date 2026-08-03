import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guarda de regressão por análise estática (mesmo padrão de
 * 0001_init.privileges.test.ts / 0002_auth_onboarding.privileges.test.ts).
 * Cobre especificamente a correção do BUG-T2-002/003
 * (qa/reports/TASK-002.md): session_id de recovery_grants precisa
 * SEMPRE ser validado contra o JWT da própria requisição — nunca
 * aceitar um valor diferente vindo do cliente, mesmo explícito.
 */

const migrationPath = path.resolve(import.meta.dirname, "0003_recovery_session.sql");
const raw = readFileSync(migrationPath, "utf8").replace(/\r\n/g, "\n").toLowerCase();
const sql = raw
  .split("\n")
  .map((line) => line.replace(/--.*$/, ""))
  .join("\n");

describe("supabase/migrations/0003_recovery_session.sql — privilégios e integridade", () => {
  it("session_id tem CHECK constraint contra o JWT — não é só um DEFAULT (contornável)", () => {
    expect(sql).toContain("constraint recovery_grants_session_matches_jwt");
    expect(sql).toContain(
      "check (session_id = ((auth.jwt() ->> 'session_id')::uuid))",
    );
  });

  it("session_id tem DEFAULT vindo do JWT (não exige o cliente enviar)", () => {
    expect(sql).toContain("default ((auth.jwt() ->> 'session_id')::uuid)");
  });

  it("RLS habilitada e policies restritas a auth.uid() = user_id em todas as operações", () => {
    expect(sql).toContain("alter table public.recovery_grants enable row level security");
    expect(sql).toContain("using (user_id = auth.uid())");
    expect(sql).toContain("with check (user_id = auth.uid())");
  });

  it("nenhum grant de tabela para anon", () => {
    const grantLines = sql.split(";").filter((stmt) => /^\s*grant\s/.test(stmt.trimStart()));
    const anonGrant = grantLines.find(
      (stmt) => /\bon\s+public\.recovery_grants\b/.test(stmt) && /\bto\b[^;]*\banon\b/.test(stmt),
    );
    expect(anonGrant).toBeUndefined();
  });

  it("authenticated recebe select/insert/update/delete só da própria linha (via RLS)", () => {
    expect(sql).toContain(
      "grant select, insert, update, delete on public.recovery_grants to authenticated",
    );
  });
});
