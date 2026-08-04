import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guarda de regressão por análise estática do SQL versionado (mesmo
 * padrão de 0001_init.privileges.test.ts, motivado pelo RETEST-BUG-001):
 * garante que os GRANTs/REVOKEs mínimos, a ausência de acesso a
 * anon/authenticated em audit_log e o hardening das novas funções
 * SECURITY DEFINER continuam presentes em edições futuras da migração.
 * Não depende de Docker/Postgres — a prova contra Postgres real fica em
 * supabase/tests/isolation_check.sql.
 */

const migrationPath = path.resolve(import.meta.dirname, "0002_auth_onboarding.sql");
const raw = readFileSync(migrationPath, "utf8").replace(/\r\n/g, "\n").toLowerCase();
const sql = raw
  .split("\n")
  .map((line) => line.replace(/--.*$/, ""))
  .join("\n");

const NEW_FUNCTIONS = [
  "onboarding_ensure_progress()",
  "onboarding_save_profile(text, text)",
  "onboarding_save_store_name(text)",
  "onboarding_save_slug(text)",
  "onboarding_save_plan(integer)",
  "onboarding_complete()",
  "is_slug_available(text)",
];

describe("supabase/migrations/0002_auth_onboarding.sql — privilégios SQL mínimos", () => {
  it("revoga tudo das 4 tabelas novas antes de conceder o mínimo", () => {
    expect(sql).toContain(
      "revoke all on public.merchant_profiles, public.onboarding_progress,\n  public.store_plans, public.audit_log",
    );
    expect(sql).toContain("from public, anon, authenticated, service_role");
  });

  it("não concede nenhum privilégio de tabela a anon nas tabelas novas", () => {
    const grantLines = sql.split(";").filter((stmt) => /^\s*grant\s/.test(stmt.trimStart()));
    const anonTableGrant = grantLines.find(
      (stmt) =>
        /\bon\s+public\.(merchant_profiles|onboarding_progress|store_plans|audit_log)\b/.test(
          stmt,
        ) && /\bto\b[^;]*\banon\b/.test(stmt),
    );
    expect(anonTableGrant).toBeUndefined();
  });

  it("concede a authenticated apenas SELECT em merchant_profiles/onboarding_progress/store_plans", () => {
    expect(sql).toContain("grant select on public.merchant_profiles to authenticated");
    expect(sql).toContain("grant select on public.onboarding_progress to authenticated");
    expect(sql).toContain("grant select on public.store_plans to authenticated");
  });

  it("audit_log não recebe NENHUM grant de tabela para anon nem authenticated", () => {
    const grantLines = sql.split(";").filter((stmt) => /^\s*grant\s/.test(stmt.trimStart()));
    const authenticatedOrAnonAuditGrant = grantLines.find(
      (stmt) =>
        /\bon\s+public\.audit_log\b/.test(stmt) &&
        (/\bto\b[^;]*\banon\b/.test(stmt) || /\bto\b[^;]*\bauthenticated\b/.test(stmt)),
    );
    expect(authenticatedOrAnonAuditGrant).toBeUndefined();
  });

  it("concede a service_role select/insert/update/delete nas 4 tabelas novas (uso administrativo)", () => {
    expect(sql).toContain(
      "grant select, insert, update, delete\n  on public.merchant_profiles, public.onboarding_progress,\n     public.store_plans, public.audit_log\n  to service_role",
    );
  });

  it("não concede truncate a nenhum papel", () => {
    expect(sql).not.toMatch(/grant[^;]*\btruncate\b[^;]*;/);
  });

  it("todas as funções SECURITY DEFINER novas usam search_path vazio", () => {
    // Casa apenas a cláusula real `language ... security definer` de uma
    // definição de função — não o texto "SECURITY DEFINER" quando citado
    // dentro de um comentário/`comment on table ... is '...'` (string
    // literal, não recebe o strip de `--` aplicado acima).
    const definerClauses =
      sql.match(/language (?:sql|plpgsql)\s*\nsecurity definer\s*\nset search_path = ''/g) ?? [];
    // 6 funções onboarding_* + is_slug_available = 7 funções SECURITY DEFINER
    expect(definerClauses.length).toBe(7);
  });

  it("cada função nova tem EXECUTE revogado de public e concedido só a authenticated (nunca anon)", () => {
    for (const fn of NEW_FUNCTIONS) {
      expect(sql).toContain(`revoke all on function public.${fn} from public`);
      expect(sql).toContain(`grant execute on function public.${fn} to authenticated`);
    }
    const grantLines = sql.split(";").filter((stmt) => /^\s*grant execute\s/.test(stmt.trimStart()));
    const anonExecuteGrant = grantLines.find((stmt) => /\bto\b[^;]*\banon\b/.test(stmt));
    expect(anonExecuteGrant).toBeUndefined();
  });

  it("onboarding_complete() não declara nenhum parâmetro (cliente não pode enviar owner_id/store_id/role/status/plano)", () => {
    expect(sql).toContain("create or replace function public.onboarding_complete()");
  });

  it("stores.status tem constraint fechada e default onboarding (fluxo público nunca grava active/suspended)", () => {
    expect(sql).toContain(
      "check (status in ('onboarding', 'pending_payment', 'active', 'suspended'))",
    );
    expect(sql).toContain("default 'onboarding'");
  });

  it("plan_code é sempre restrito a 30|50|80 (onboarding_progress e store_plans)", () => {
    const planCodeChecks = sql.match(/check \(plan_code in \(30, 50, 80\)\)/g) ?? [];
    expect(planCodeChecks.length).toBeGreaterThanOrEqual(2);
  });

  it("onboarding_complete trata unique_violation de slug como erro tratado, não crash silencioso", () => {
    expect(sql).toContain("when unique_violation then");
    expect(sql).toContain("raise exception 'slug_taken'");
  });

  it("onboarding_complete usa advisory lock por usuário para evitar duplo-submit concorrente", () => {
    expect(sql).toContain("pg_advisory_xact_lock(hashtext('onboarding_complete:'");
  });

  it("não há colunas serial/identity novas (sem sequence a conceder privilégio)", () => {
    expect(sql).not.toMatch(/\bserial\b|\bidentity\b|\bbigserial\b/);
  });
});
