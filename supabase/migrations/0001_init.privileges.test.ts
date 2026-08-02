import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guarda de regressão para RETEST-BUG-001 (qa/reports/TASK-001-RETEST.md):
 * a migração tinha RLS/policies mas nenhum GRANT de tabela, então
 * `authenticated`/`service_role` recebiam "permission denied" antes de
 * qualquer policy ser avaliada. Não depende de Docker/Postgres — apenas
 * garante, por análise estática do SQL versionado, que os GRANTs/REVOKEs
 * mínimos continuam presentes. A prova de que eles realmente funcionam
 * contra Postgres real está em supabase/tests/isolation_check.sql
 * (requer Docker, documentado em docs/HANDOFF.md).
 */

const migrationPath = path.resolve(
  import.meta.dirname,
  "0001_init.sql",
);
const raw = readFileSync(migrationPath, "utf8").toLowerCase();

// Remove comentários de linha (`-- ...`) antes de qualquer asserção —
// caso contrário, prosa explicativa que menciona termos como "truncate"
// ou "serial" (para dizer que NÃO são usados) faria os testes de
// ausência falharem por casar com o comentário, não com SQL real.
const sql = raw
  .split("\n")
  .map((line) => line.replace(/--.*$/, ""))
  .join("\n");

describe("supabase/migrations/0001_init.sql — privilégios SQL mínimos", () => {
  it("revoga tudo de public/anon/authenticated/service_role antes de conceder o mínimo", () => {
    expect(sql).toContain(
      "revoke all on public.stores, public.store_members, public.products",
    );
    expect(sql).toContain("from public, anon, authenticated, service_role");
  });

  it("concede usage no schema public aos três papéis usados pela aplicação", () => {
    expect(sql).toContain(
      "grant usage on schema public to anon, authenticated, service_role",
    );
  });

  it("não concede nenhum privilégio de tabela a anon (sem storefront público nesta fundação)", () => {
    const grantLines = sql
      .split(";")
      .filter((stmt) => /^\s*grant\s/.test(stmt.trimStart()));
    const anonTableGrant = grantLines.find(
      (stmt) =>
        /\bon\s+public\.(stores|store_members|products)/.test(stmt) &&
        /\bto\b[^;]*\banon\b/.test(stmt),
    );
    expect(anonTableGrant).toBeUndefined();
  });

  it("concede a authenticated exatamente as operações cobertas por policy de RLS", () => {
    expect(sql).toContain("grant select on public.stores to authenticated");
    expect(sql).toContain(
      "grant select on public.store_members to authenticated",
    );
    expect(sql).toContain(
      "grant select, insert, update, delete on public.products to authenticated",
    );
  });

  it("concede a service_role select/insert/update/delete nas três tabelas (uso administrativo/seed)", () => {
    expect(sql).toContain(
      "grant select, insert, update, delete\n  on public.stores, public.store_members, public.products\n  to service_role",
    );
  });

  it("não concede truncate a nenhum papel (ignoraria RLS por completo)", () => {
    expect(sql).not.toMatch(/grant[^;]*\btruncate\b[^;]*;/);
  });

  it("funções SECURITY DEFINER usam search_path vazio e têm EXECUTE restrito a authenticated", () => {
    const definerBlocks = sql.split("security definer").slice(1);
    expect(definerBlocks.length).toBeGreaterThanOrEqual(2);
    for (const block of definerBlocks) {
      expect(block.slice(0, 80)).toContain("set search_path = ''");
    }

    expect(sql).toContain(
      "revoke all on function public.is_store_member(uuid) from public",
    );
    expect(sql).toContain(
      "revoke all on function public.is_store_admin(uuid) from public",
    );
    expect(sql).toContain(
      "grant execute on function public.is_store_member(uuid) to authenticated",
    );
    expect(sql).toContain(
      "grant execute on function public.is_store_admin(uuid) to authenticated",
    );
  });

  it("não há colunas serial/identity (nenhuma sequence a conceder privilégio)", () => {
    expect(sql).not.toMatch(/\bserial\b|\bidentity\b|\bbigserial\b/);
  });
});
