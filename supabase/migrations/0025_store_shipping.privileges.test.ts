import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guarda de regressão por análise estática para
 * supabase/migrations/0025_store_shipping.sql (TASK-013 — frete por CEP).
 * Mesmo padrão das migrations anteriores: normaliza CRLF/comentários e
 * faz asserções sobre o texto bruto do SQL versionado.
 *
 * O comportamento em si (faixas, acréscimo, frete grátis, snapshot,
 * autorização) é provado contra Postgres real em
 * supabase/tests/shipping_check.sql — 16 casos. O que este arquivo trava
 * é o que a execução não pega sozinha: privilégio concedido a mais,
 * policy pública aparecendo, um parâmetro de dinheiro entrando na RPC
 * pública, ou a ordem das faixas sendo trocada numa edição futura.
 */

const migrationPath = path.resolve(import.meta.dirname, "0025_store_shipping.sql");
const raw = readFileSync(migrationPath, "utf8").replace(/\r\n/g, "\n").toLowerCase();
const sql = raw
  .split("\n")
  .map((line) => line.replace(/--.*$/, ""))
  .join("\n");

describe("store_shipping_settings — privilégios e isolamento", () => {
  it("RLS habilitada, e a única policy é de SELECT para membro da loja", () => {
    expect(sql).toContain("alter table public.store_shipping_settings enable row level security");
    expect(sql).toMatch(
      /create policy store_shipping_settings_select_member[\s\S]*?using \(public\.is_store_member\(store_id\)\)/,
    );
    const policies = sql.match(/create policy \w+\s+on public\.store_shipping_settings/g) ?? [];
    expect(policies).toHaveLength(1);
  });

  it("revoga o default do Supabase antes de conceder — a lição de 0021", () => {
    expect(sql).toContain(
      "revoke all on public.store_shipping_settings from public, anon, authenticated, service_role",
    );
    const revokeIndex = sql.indexOf("revoke all on public.store_shipping_settings");
    const firstGrantIndex = sql.indexOf("grant select on public.store_shipping_settings");
    expect(revokeIndex).toBeGreaterThan(-1);
    expect(firstGrantIndex).toBeGreaterThan(revokeIndex);
  });

  it("anon nunca recebe grant nenhum na tabela, e authenticated só SELECT", () => {
    const grantLines = sql
      .split(";")
      .filter((s) => /^\s*grant\s/.test(s.trimStart()) && /\bon\s+public\.store_shipping_settings\b/.test(s));
    expect(grantLines.length).toBeGreaterThan(0);
    for (const line of grantLines) {
      expect(line).not.toMatch(/\banon\b/);
      if (/\bto\b[^;]*\bauthenticated\b/.test(line)) {
        expect(line).not.toMatch(/\b(insert|update|delete|truncate|all)\b/);
      }
    }
  });

  it("a escrita exige owner/admin + loja active + sessão viva (can_manage_store_catalog)", () => {
    const fn = sql.slice(
      sql.indexOf("create or replace function public.shipping_settings_upsert"),
      sql.indexOf("comment on function public.shipping_settings_upsert"),
    );
    expect(fn).toContain("if not public.can_manage_store_catalog(p_store_id) then");
    expect(fn).toContain("raise exception 'insufficient_privilege'");
    expect(fn).toContain("security definer");
    expect(fn).toContain("set search_path = ''");
  });

  it("nenhuma função de escrita ou leitura administrativa é concedida a anon", () => {
    for (const fn of ["shipping_settings_get", "shipping_settings_upsert"]) {
      const grants = sql.split("\n").filter((line) => line.includes(`grant execute on function public.${fn}`));
      expect(grants.length).toBeGreaterThan(0);
      for (const grant of grants) {
        expect(grant).not.toMatch(/\banon\b/);
      }
    }
  });
});

describe("shipping_fee_for — a regra financeira", () => {
  const fn = sql.slice(
    sql.indexOf("create or replace function public.shipping_fee_for"),
    sql.indexOf("comment on function public.shipping_fee_for"),
  );

  it("frete grátis é decidido ANTES das faixas e retorna zero exato", () => {
    const freeIndex = fn.indexOf("'free'::text, 0");
    const sameCityIndex = fn.indexOf("'same_city'::text");
    expect(freeIndex).toBeGreaterThan(-1);
    expect(sameCityIndex).toBeGreaterThan(freeIndex);
  });

  it("o acréscimo NÃO entra no ramo do frete grátis", () => {
    const freeBranch = fn.slice(fn.indexOf("p_free_shipping_enabled, false"), fn.indexOf("'same_city'::text"));
    expect(freeBranch).toContain("'free'::text, 0");
    expect(freeBranch).not.toContain("p_additional_fee_cents");
  });

  it("as três faixas somam o acréscimo", () => {
    for (const rule of ["same_city", "same_state", "other_state"]) {
      const branch = fn.slice(fn.indexOf(`'${rule}'::text`));
      expect(branch.slice(0, 200)).toContain("p_additional_fee_cents");
    }
  });

  it("mesma cidade exige cidade E UF iguais; mesmo estado só a UF", () => {
    expect(fn).toMatch(
      /v_dest_state is not distinct from v_origin_state\s*\n?\s*and v_dest_city is not distinct from v_origin_city/,
    );
  });

  it("os dois lados da comparação passam pela normalização", () => {
    expect(fn).toContain("v_origin_city text := public.shipping_normalize_city(p_origin_city)");
    expect(fn).toContain("v_dest_city text := public.shipping_normalize_city(p_dest_city)");
    expect(fn).toContain("v_origin_state text := public.shipping_normalize_state(p_origin_state)");
    expect(fn).toContain("v_dest_state text := public.shipping_normalize_state(p_dest_state)");
  });
});

describe("shipping_postal_codes — o destino só entra pelo servidor", () => {
  it("nem anon nem authenticated recebem qualquer privilégio na tabela", () => {
    expect(sql).toContain(
      "revoke all on public.shipping_postal_codes from public, anon, authenticated, service_role",
    );
    const grantLines = sql
      .split(";")
      .filter((s) => /^\s*grant\s/.test(s.trimStart()) && /\bon\s+public\.shipping_postal_codes\b/.test(s));
    expect(grantLines.length).toBeGreaterThan(0);
    for (const line of grantLines) {
      expect(line).not.toMatch(/\banon\b/);
      expect(line).not.toMatch(/\bauthenticated\b/);
      expect(line).toMatch(/\bservice_role\b/);
    }
  });

  it("a tabela não tem policy nenhuma — só as funções SECURITY DEFINER leem", () => {
    expect(sql).toContain("alter table public.shipping_postal_codes enable row level security");
    expect(sql).not.toMatch(/create policy \w+\s+on public\.shipping_postal_codes/);
  });

  it("shipping_postal_code_upsert é executável SÓ por service_role", () => {
    expect(sql).toContain(
      "revoke all on function public.shipping_postal_code_upsert(text, text, text) from public, anon, authenticated",
    );
    expect(sql).toContain(
      "grant execute on function public.shipping_postal_code_upsert(text, text, text) to service_role",
    );
    const grants = sql
      .split("\n")
      .filter((line) => line.includes("grant execute on function public.shipping_postal_code_upsert"));
    for (const grant of grants) {
      expect(grant).not.toMatch(/\banon\b/);
      expect(grant).not.toMatch(/\bauthenticated\b/);
    }
  });
});

describe("nenhum valor financeiro — nem o destino — entra pelo cliente", () => {
  const signature = sql.slice(
    sql.indexOf("create or replace function public.create_order"),
    sql.indexOf("returns public.orders"),
  );

  it("create_order não tem parâmetro de frete, desconto ou total", () => {
    expect(signature).toContain("p_shipping_postal_code");
    expect(signature).not.toContain("p_shipping_amount");
    expect(signature).not.toContain("p_shipping_cents");
    expect(signature).not.toContain("p_total_cents");
    expect(signature).not.toContain("p_discount_cents");
    expect(signature).not.toContain("p_subtotal");
  });

  /**
   * A regressão mais cara desta task: cidade e UF decidem a FAIXA, então
   * aceitá-las do navegador equivale a aceitar o preço. Um CEP de São
   * Paulo com city="Corumbá" pagava frete de mesma cidade.
   */
  it("create_order NÃO aceita cidade nem UF de destino", () => {
    expect(signature).not.toContain("p_shipping_city");
    expect(signature).not.toContain("p_shipping_state");
  });

  it("o destino sai de shipping_resolve_destination, e CEP não resolvido recusa o pedido", () => {
    const fn = sql.slice(
      sql.indexOf("create or replace function public.create_order"),
      sql.indexOf("comment on function public.create_order"),
    );
    expect(fn).toContain("public.shipping_resolve_destination(v_ship_postal)");
    expect(fn).toContain("raise exception 'shipping_destination_unresolved'");
  });

  it("p_expected_total_cents só recusa — nunca substitui o total calculado", () => {
    const fn = sql.slice(
      sql.indexOf("create or replace function public.create_order"),
      sql.indexOf("comment on function public.create_order"),
    );
    expect(signature).toContain("p_expected_total_cents integer default null");
    expect(fn).toContain("raise exception 'total_changed'");
    // O total gravado é sempre v_total (recalculado); o parâmetro do
    // cliente nunca é atribuído a ele.
    expect(fn).not.toMatch(/v_total\s*:=\s*p_expected_total_cents/);
  });

  it("shipping_quote recebe ITENS e CEP — nem subtotal, nem cidade, nem UF", () => {
    const quoteSignature = sql.slice(
      sql.indexOf("create or replace function public.shipping_quote"),
      sql.indexOf("returns table (\n  shipping_enabled"),
    );
    expect(quoteSignature).toContain("p_items jsonb");
    expect(quoteSignature).toContain("p_postal_code text");
    expect(quoteSignature).not.toContain("p_subtotal_cents");
    expect(quoteSignature).not.toContain("p_city");
    expect(quoteSignature).not.toContain("p_state");
  });

  it("a prévia resolve o destino do mesmo jeito que o pedido", () => {
    const fn = sql.slice(
      sql.indexOf("create or replace function public.shipping_quote"),
      sql.indexOf("comment on function public.shipping_quote"),
    );
    expect(fn).toContain("public.shipping_resolve_destination(v_postal)");
    expect(fn).toContain("'destination_unresolved'");
  });

  it("shipping_quote é stable e recalcula o subtotal a partir de products", () => {
    const fn = sql.slice(
      sql.indexOf("create or replace function public.shipping_quote"),
      sql.indexOf("comment on function public.shipping_quote"),
    );
    expect(fn).toContain("stable");
    expect(fn).toContain("from public.products p");
    expect(fn).toContain("p.status = 'published'");
    expect(fn).toContain("public.coupon_validate(");
  });
});

describe("create_order — frete calculado no banco e gravado como snapshot", () => {
  const fn = sql.slice(
    sql.indexOf("create or replace function public.create_order"),
    sql.indexOf("comment on function public.create_order"),
  );

  it("substitui a versão anterior em vez de criar sobrecarga", () => {
    expect(sql).toContain(
      "drop function if exists public.create_order(text, uuid, text, text, text, text, text, jsonb, text)",
    );
  });

  it("o frete é calculado DEPOIS do cupom (o mínimo do frete grátis olha o subtotal descontado)", () => {
    const couponIndex = fn.indexOf("public.coupon_validate(v_store_id, v_coupon_code, v_subtotal)");
    const shippingIndex = fn.indexOf("public.shipping_fee_for(");
    expect(couponIndex).toBeGreaterThan(-1);
    expect(shippingIndex).toBeGreaterThan(couponIndex);
  });

  it("o endereço entra no fingerprint de idempotência", () => {
    const fingerprint = fn.slice(fn.indexOf("v_fingerprint := md5("), fn.indexOf("perform pg_advisory_xact_lock"));
    expect(fingerprint).toContain("v_ship_postal");
    expect(fingerprint).toContain("public.shipping_normalize_city(v_ship_city)");
    expect(fingerprint).toContain("v_ship_state");
  });

  it("o caminho legado (loja sem frete) continua exigindo endereço livre e não cobra nada", () => {
    expect(fn).toContain("raise exception 'delivery_address_required'");
    expect(fn).toContain("v_shipping_cents integer := 0");
    expect(fn).toContain(
      "v_structured_shipping := p_fulfillment_method = 'delivery'\n    and v_settings.id is not null and v_settings.enabled",
    );
  });

  it("origem usada no cálculo é gravada no pedido", () => {
    expect(fn).toContain("shipping_origin_postal_code");
    expect(fn).toContain("shipping_origin_city");
    expect(fn).toContain("shipping_origin_state");
  });
});

describe("orders — a verdade financeira do pedido", () => {
  it("a CHECK do total passa a conhecer as três parcelas", () => {
    expect(sql).toContain("alter table public.orders drop constraint orders_total_matches_discount");
    expect(sql).toContain(
      "check (total_cents = subtotal_cents - discount_cents + shipping_amount_cents)",
    );
  });

  it("colunas novas nascem com backfill neutro — nenhum pedido antigo passa a ter frete", () => {
    expect(sql).toContain("add column shipping_amount_cents integer not null default 0 check (shipping_amount_cents >= 0)");
  });

  it("a faixa gravada é restrita ao vocabulário do domínio", () => {
    expect(sql).toContain("shipping_rule in ('free', 'same_city', 'same_state', 'other_state')");
  });

  it("pedido com faixa aplicada tem que ter destino gravado", () => {
    expect(sql).toContain("orders_shipping_snapshot_complete");
  });
});

describe("audit_log_action_check — só ALARGA", () => {
  it("adiciona a action nova preservando todas as anteriores", () => {
    const constraint = sql.slice(
      sql.indexOf("alter table public.audit_log add constraint audit_log_action_check"),
      sql.indexOf("-- ============================================================\n-- 6."),
    );
    expect(constraint).toContain("'shipping_settings_updated'");
    // Amostra de cada task anterior — se alguma sumir, a lista estreitou.
    for (const action of [
      "'signup_completed'",
      "'order_created'",
      "'pix_payment_approved'",
      "'store_suspended_by_billing_overdue'",
      "'member_invited'",
      "'session_revoked'",
      "'coupon_released'",
    ]) {
      expect(constraint).toContain(action);
    }
  });
});
