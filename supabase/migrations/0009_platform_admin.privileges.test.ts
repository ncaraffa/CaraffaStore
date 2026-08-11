import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guarda de regressão por análise estática para
 * supabase/migrations/0009_platform_admin.sql (painel exclusivo do dono
 * da plataforma). Mesmo padrão das migrations anteriores (ver
 * 0008_saas_billing.privileges.test.ts): normaliza CRLF/comentários e
 * faz asserções sobre o texto bruto do SQL versionado — não requer
 * Postgres/Docker rodando.
 */

const migrationPath = path.resolve(import.meta.dirname, "0009_platform_admin.sql");
const raw = readFileSync(migrationPath, "utf8").replace(/\r\n/g, "\n").toLowerCase();
const sql = raw
  .split("\n")
  .map((line) => line.replace(/--.*$/, ""))
  .join("\n");

describe("platform_admins — allowlist mínima, deny-by-default", () => {
  it("RLS habilitada, ZERO policy (mesmo padrão de billing_charges/audit_log)", () => {
    expect(sql).toContain("alter table public.platform_admins enable row level security");
    const policyNames = [...sql.matchAll(/create policy (\w+)\s+on public\.platform_admins/g)].map((m) => m[1]);
    expect(policyNames).toEqual([]);
  });

  it("nenhum GRANT pra anon/authenticated — só service_role grava", () => {
    expect(sql).toContain("revoke all on public.platform_admins from public, anon, authenticated, service_role");
    expect(sql).toContain("grant select, insert, update, delete on public.platform_admins to service_role");
  });

  it("sem função pública de auto-concessão — nenhuma das 3 funções SECURITY DEFINER insere em platform_admins", () => {
    for (const fn of ["is_platform_admin", "platform_admin_store_overview", "platform_admin_set_store_status"]) {
      const body = sql.slice(
        sql.indexOf(`create or replace function public.${fn}`),
        sql.indexOf(`comment on function public.${fn}`),
      );
      expect(body, `${fn} não deveria inserir em platform_admins`).not.toContain("insert into public.platform_admins");
    }
  });
});

describe("stores.pre_suspension_status — reativação nunca promove indevidamente", () => {
  it("coluna nova restrita a onboarding/pending_payment/active (nunca 'suspended' — não faria sentido guardar suspenso como status anterior)", () => {
    expect(sql).toContain(
      "add column if not exists pre_suspension_status text\n    check (pre_suspension_status in ('onboarding', 'pending_payment', 'active'))",
    );
  });
});

describe("is_platform_admin — única fonte de verdade de acesso ao painel", () => {
  const fnBody = () =>
    sql.slice(
      sql.indexOf("create or replace function public.is_platform_admin"),
      sql.indexOf("comment on function public.is_platform_admin"),
    );

  it("search_path vazio, checa platform_admins por auth.uid() — nunca claim de JWT nem parâmetro do cliente", () => {
    const fn = fnBody();
    expect(fn).toContain("set search_path = ''");
    expect(fn).toContain("from public.platform_admins pa where pa.user_id = auth.uid()");
  });

  it("concedida a authenticated e service_role, nunca a anon/public direto", () => {
    const grantLine = sql.split(";").find((s) => s.includes("grant execute on function public.is_platform_admin("));
    expect(grantLine).toBeTruthy();
    expect(grantLine).toContain("authenticated");
    expect(grantLine).toContain("service_role");
    expect(grantLine).not.toMatch(/\banon\b/);
    expect(sql).toContain("revoke all on function public.is_platform_admin() from public");
  });
});

describe("platform_admin_store_overview — única leitura cross-tenant, sempre gated", () => {
  const fnBody = () =>
    sql.slice(
      sql.indexOf("create or replace function public.platform_admin_store_overview"),
      sql.indexOf("comment on function public.platform_admin_store_overview"),
    );

  it("primeira coisa que a função faz é checar is_platform_admin() e recusar com insufficient_privilege", () => {
    const fn = fnBody();
    const checkIndex = fn.indexOf("if not public.is_platform_admin() then");
    const queryIndex = fn.indexOf("return query");
    expect(checkIndex).toBeGreaterThan(-1);
    expect(queryIndex).toBeGreaterThan(-1);
    expect(checkIndex).toBeLessThan(queryIndex);
    expect(fn).toContain("insufficient_privilege");
  });

  it("nunca devolve provider_payment_id/idempotency_key/documento — só o necessário pro painel (contato do dono, cobrança mais recente)", () => {
    const fn = fnBody();
    expect(fn).not.toContain("provider_payment_id");
    expect(fn).not.toContain("provider_idempotency_key");
    expect(fn).not.toContain("payer_doc");
  });

  it("concedida a authenticated (o próprio is_platform_admin() interno já barra quem não é admin)", () => {
    const grantLine = sql.split(";").find((s) => s.includes("grant execute on function public.platform_admin_store_overview("));
    expect(grantLine).toBeTruthy();
    expect(grantLine).toContain("authenticated");
    expect(grantLine).not.toMatch(/\banon\b/);
  });
});

describe("platform_admin_set_store_status — suspender/reativar sem promover indevidamente", () => {
  const fnBody = () =>
    sql.slice(
      sql.indexOf("create or replace function public.platform_admin_set_store_status"),
      sql.indexOf("comment on function public.platform_admin_set_store_status"),
    );

  it("checa is_platform_admin() e só aceita 'suspend'/'reactivate' — nunca um status arbitrário do cliente", () => {
    const fn = fnBody();
    expect(fn).toContain("if not public.is_platform_admin() then");
    expect(fn).toContain("insufficient_privilege");
    expect(fn).toContain("if p_action not in ('suspend', 'reactivate') then");
    expect(fn).toContain("invalid_action");
  });

  it("suspend guarda o status atual em pre_suspension_status antes de sobrescrever", () => {
    const fn = fnBody();
    const suspendBranch = fn.slice(fn.indexOf("if p_action = 'suspend' then"), fn.indexOf("else"));
    expect(suspendBranch).toContain("pre_suspension_status = v_store.status");
    expect(suspendBranch).toContain("status = 'suspended'");
  });

  it("reactivate restaura pre_suspension_status (coalesce pra 'active' só se nulo) — NUNCA escreve status = 'active' fixo, senão uma loja pending_payment suspensa reativaria sem pagar", () => {
    const fn = fnBody();
    const reactivateBranch = fn.slice(fn.indexOf("else"), fn.lastIndexOf("return v_store"));
    expect(reactivateBranch).toContain("coalesce(v_store.pre_suspension_status, 'active')");
    expect(reactivateBranch).not.toMatch(/status\s*=\s*'active'(?!\s*,\s*pre_suspension_status)/);
    expect(reactivateBranch).toContain("if v_store.status <> 'suspended' then");
    expect(reactivateBranch).toContain("store_not_suspended");
  });

  it("grava audit_log com actor_user_id = auth.uid() em ambos os ramos, nunca null/spoofável", () => {
    const fn = fnBody();
    const auditInserts = fn.match(/insert into public\.audit_log \(actor_user_id[^)]*\)\s*\n\s*values \(auth\.uid\(\)/g) ?? [];
    expect(auditInserts.length).toBe(2);
  });

  it("é idempotente: suspender uma loja já suspensa não sobrescreve pre_suspension_status de novo", () => {
    const fn = fnBody();
    expect(fn).toContain("if v_store.status = 'suspended' then\n      return v_store;");
  });

  it("concedida a authenticated, nunca a anon", () => {
    const grantLine = sql
      .split(";")
      .find((s) => s.includes("grant execute on function public.platform_admin_set_store_status("));
    expect(grantLine).toBeTruthy();
    expect(grantLine).toContain("authenticated");
    expect(grantLine).not.toMatch(/\banon\b/);
  });
});

describe("audit_log_action_check — só ALARGA", () => {
  it("inclui os 2 novos eventos de suspensão/reativação pelo painel do dono, sem remover nenhum valor anterior", () => {
    const constraintBlock = sql.slice(
      sql.indexOf("add constraint audit_log_action_check check (action in ("),
      sql.lastIndexOf("));"),
    );
    for (const action of [
      "store_suspended_by_platform_admin",
      "store_reactivated_by_platform_admin",
      // Amostra de valores herdados das migrations anteriores — prova
      // que o conjunto cresceu em vez de ser substituído.
      "billing_charge_approved",
      "store_activated_by_billing",
      "order_created",
    ]) {
      expect(constraintBlock, `audit_log_action_check não inclui ${action}`).toContain(`'${action}'`);
    }
  });
});

describe("seed do primeiro admin — condicional, nunca cria conta", () => {
  it("insere só se a conta já existir (select de auth.users), nunca INSERT em auth.users", () => {
    const seedBlock = sql.slice(sql.lastIndexOf("insert into public.platform_admins"));
    expect(seedBlock).toContain("select id from auth.users where email = 'caraffastore@gmail.com'");
    expect(seedBlock).toContain("on conflict (user_id) do nothing");
    expect(sql).not.toContain("insert into auth.users");
  });
});
