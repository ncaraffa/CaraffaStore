import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guarda de regressão por análise estática para
 * supabase/migrations/0003_recovery_session.sql — a reescrita completa
 * do mecanismo de prova de finalidade depois do reteste do Júnior
 * (qa/reports/TASK-002-RETEST.md). Cobre especificamente os
 * bloqueadores 1 a 5 (BUG-RT2-001 a 005) e os requisitos 1-4/14 da
 * lista de testes regressivos obrigatórios daquele relatório.
 */

const migrationPath = path.resolve(import.meta.dirname, "0003_recovery_session.sql");
const raw = readFileSync(migrationPath, "utf8").replace(/\r\n/g, "\n").toLowerCase();
const sql = raw
  .split("\n")
  .map((line) => line.replace(/--.*$/, ""))
  .join("\n");

describe("supabase/migrations/0003_recovery_session.sql — auth_flow_grants sem nenhum grant de tabela para cliente", () => {
  it("revoga TUDO de public/anon/authenticated/service_role antes de conceder de volta", () => {
    expect(sql).toContain(
      "revoke all on public.auth_flow_grants from public, anon, authenticated, service_role",
    );
  });

  it("nenhum GRANT de tabela para anon nem authenticated — requisito 1: authenticated não consegue inserir/alterar/apagar diretamente", () => {
    const grantLines = sql.split(";").filter((stmt) => /^\s*grant\s+(select|insert|update|delete)/.test(stmt.trimStart()));
    const clientGrant = grantLines.find(
      (stmt) =>
        /\bon\s+public\.auth_flow_grants\b/.test(stmt) &&
        (/\bto\b[^;]*\banon\b/.test(stmt) || /\bto\b[^;]*\bauthenticated\b/.test(stmt)),
    );
    expect(clientGrant).toBeUndefined();
  });

  it("só service_role recebe grant de tabela (uso administrativo)", () => {
    expect(sql).toContain("grant select, insert, update, delete on public.auth_flow_grants to service_role");
  });

  it("RLS habilitada, sem nenhuma policy criada (nem authenticated bypassa via RLS — requisito 1: não confiar só em RLS)", () => {
    expect(sql).toContain("alter table public.auth_flow_grants enable row level security");
    expect(sql).not.toMatch(/create policy[^;]*auth_flow_grants/);
  });

  it("expires_at é NOT NULL (obrigatório) e há colunas purpose/session_id/consumed_at", () => {
    expect(sql).toMatch(/expires_at timestamptz not null/);
    expect(sql).toContain("purpose text not null check (purpose in ('email_confirmation', 'password_recovery'))");
    expect(sql).toContain("session_id uuid,");
    expect(sql).toContain("consumed_at timestamptz");
  });

  it("um pedido pendente por usuário e propósito (unique constraint)", () => {
    expect(sql).toContain("constraint auth_flow_grants_user_purpose_unique unique (user_id, purpose)");
  });
});

describe("emissão de grant — requisito 3: nenhuma RPC de emissão chamável por authenticated concede acesso sozinha", () => {
  it("confirmação de cadastro nasce só de um TRIGGER em auth.users — nenhuma RPC equivalente existe", () => {
    expect(sql).toContain("after insert on auth.users");
    expect(sql).toContain("execute function public.handle_new_user_confirmation_grant()");
    // A função do trigger não recebe NENHUM grant de execução direto —
    // só é invocável pelo próprio mecanismo de trigger do Postgres.
    expect(sql).not.toMatch(/grant execute[^;]*handle_new_user_confirmation_grant/);
  });

  it("request_password_recovery_grant só aceita p_email — nunca user_id/session_id vindo do cliente (requisito 2)", () => {
    expect(sql).toContain("create or replace function public.request_password_recovery_grant(p_email text)");
    expect(sql).not.toMatch(/request_password_recovery_grant\([^)]*user_id/);
    expect(sql).not.toMatch(/request_password_recovery_grant\([^)]*session_id/);
  });

  it("request_password_recovery_grant resolve o usuário pelo e-mail internamente (select ... from auth.users), nunca aceita o id pronto", () => {
    expect(sql).toContain("select id into v_uid from auth.users where lower(email) = lower(trim(p_email))");
  });

  it("EXECUTE de request_password_recovery_grant concedido a anon e authenticated (fluxo pré-autenticação)", () => {
    expect(sql).toContain(
      "grant execute on function public.request_password_recovery_grant(text) to anon, authenticated",
    );
  });
});

describe("consumo/reivindicação — requisito 14: nenhuma função aceita nonce/user_id/session_id do cliente", () => {
  it("consume_auth_flow_grant só aceita p_purpose — usa auth.uid()/auth.jwt() internamente, nunca um id vindo do cliente", () => {
    expect(sql).toContain("create or replace function public.consume_auth_flow_grant(p_purpose text)");
    expect(sql).not.toMatch(/consume_auth_flow_grant\([^)]*user_id/);
    expect(sql).not.toMatch(/consume_auth_flow_grant\([^)]*session_id/);
    expect(sql).not.toMatch(/consume_auth_flow_grant\([^)]*nonce/);
    expect(sql).toContain("v_uid uuid := auth.uid()");
  });

  it("claim_recovery_grant_for_password_change não aceita NENHUM parâmetro", () => {
    expect(sql).toContain("create or replace function public.claim_recovery_grant_for_password_change()\nreturns boolean");
  });

  it("is_current_session_recovery_grant não aceita NENHUM parâmetro", () => {
    expect(sql).toContain("create or replace function public.is_current_session_recovery_grant()\nreturns boolean");
  });

  it("EXECUTE de consume/claim/is_current_session só para authenticated, nunca anon nem PUBLIC", () => {
    for (const fn of [
      "consume_auth_flow_grant(text)",
      "claim_recovery_grant_for_password_change()",
      "is_current_session_recovery_grant()",
    ]) {
      const escaped = fn.replace(/[()]/g, (c) => `\\${c}`);
      expect(sql).toMatch(new RegExp(`grant execute on function public\\.${escaped} to authenticated`));
    }
    const grantLines = sql.split(";").filter((stmt) => /^\s*grant execute\s/.test(stmt.trimStart()));
    const anonGrant = grantLines.find(
      (stmt) =>
        /\b(consume_auth_flow_grant|claim_recovery_grant_for_password_change|is_current_session_recovery_grant)\b/.test(
          stmt,
        ) && /\bto\b[^;]*\banon\b/.test(stmt),
    );
    expect(anonGrant).toBeUndefined();
  });

  it("todas as funções novas revogam de PUBLIC antes de conceder (EXECUTE não fica implícito a PUBLIC — bloqueador 5)", () => {
    const occurrences = sql.match(/revoke all on function[^;]*from public/g) ?? [];
    // handle_new_user_confirmation_grant, request_password_recovery_grant,
    // consume_auth_flow_grant, claim_recovery_grant_for_password_change,
    // is_current_session_recovery_grant = 5 funções.
    expect(occurrences.length).toBe(5);
  });
});

describe("atomicidade — requisito 16/19: consumo em UPDATE/DELETE único, sem consultar-depois-agir, auditoria dentro da mesma transação", () => {
  it("consume_auth_flow_grant faz um UPDATE condicional único (consumed_at is null and expires_at > now()) — sem SELECT prévio separado", () => {
    expect(sql).toContain("update public.auth_flow_grants\n  set consumed_at = now()");
    expect(sql).toMatch(/and consumed_at is null\s*\n\s*and expires_at > now\(\)/);
  });

  it("claim_recovery_grant_for_password_change faz um DELETE condicional único (consumed_at is not null and expires_at > now())", () => {
    expect(sql).toContain("delete from public.auth_flow_grants");
    expect(sql).toMatch(/and consumed_at is not null\s*\n\s*and expires_at > now\(\)/);
  });

  it("auditoria é inserida DENTRO das mesmas funções (sem exception handler ao redor) — falha no insert derruba toda a função (requisito 19)", () => {
    // As duas inserções em audit_log não podem estar dentro de um bloco
    // "begin ... exception when ... end" que engoliria o erro — só existe
    // UM bloco "begin"/"end" por função (o corpo inteiro), sem
    // "exception when" nenhum nestas duas funções.
    const consumeFn = sql.slice(
      sql.indexOf("create or replace function public.consume_auth_flow_grant"),
      sql.indexOf("create or replace function public.claim_recovery_grant_for_password_change"),
    );
    expect(consumeFn).toContain("insert into public.audit_log");
    expect(consumeFn).not.toContain("exception when");

    const claimFn = sql.slice(
      sql.indexOf("create or replace function public.claim_recovery_grant_for_password_change"),
      sql.indexOf("create or replace function public.is_current_session_recovery_grant"),
    );
    expect(claimFn).toContain("insert into public.audit_log");
    expect(claimFn).not.toContain("exception when");
  });
});

describe("SECURITY DEFINER com search_path vazio em todas as funções novas", () => {
  it("5 funções, todas security definer com search_path vazio", () => {
    const occurrences = sql.match(/security definer\s*\nset search_path = ''/g) ?? [];
    expect(occurrences.length).toBe(5);
  });
});
