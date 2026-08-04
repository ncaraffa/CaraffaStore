import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guarda de regressão por análise estática para
 * supabase/migrations/0005_catalog.sql (TASK-003 — catálogo, produtos,
 * categorias, imagens, estoque). Mesmo padrão das migrations
 * anteriores: normaliza CRLF/comentários e faz asserções sobre o texto
 * bruto do SQL versionado.
 */

const migrationPath = path.resolve(import.meta.dirname, "0005_catalog.sql");
const raw = readFileSync(migrationPath, "utf8").replace(/\r\n/g, "\n").toLowerCase();
const sql = raw
  .split("\n")
  .map((line) => line.replace(/--.*$/, ""))
  .join("\n");

describe("can_manage_store_catalog — autorização operacional (owner/admin E loja active)", () => {
  it("checa role owner/admin E stores.status = 'active' na mesma query", () => {
    const fn = sql.slice(
      sql.indexOf("create or replace function public.can_manage_store_catalog"),
      sql.indexOf("comment on function public.can_manage_store_catalog"),
    );
    expect(fn).toContain("sm.role in ('owner', 'admin')");
    expect(fn).toContain("s.status = 'active'");
  });

  it("SECURITY DEFINER, search_path vazio, revogada de public, EXECUTE só para authenticated", () => {
    expect(sql).toContain(
      "revoke all on function public.can_manage_store_catalog(uuid) from public",
    );
    expect(sql).toContain(
      "grant execute on function public.can_manage_store_catalog(uuid) to authenticated",
    );
  });

  it("nenhuma função catalog_* de escrita usa is_store_admin diretamente (todas migraram para can_manage_store_catalog)", () => {
    const catalogFunctionNames = [
      "catalog_create_category",
      "catalog_update_category",
      "catalog_set_category_active",
      "catalog_create_product",
      "catalog_update_product",
      "catalog_set_product_status",
      "catalog_adjust_stock",
      "catalog_add_product_image",
      "catalog_remove_product_image",
      "catalog_set_cover_image",
      "catalog_move_product_image",
    ];
    for (const name of catalogFunctionNames) {
      const start = sql.indexOf(`create or replace function public.${name}`);
      const nextFn = sql.indexOf("create or replace function public.", start + 1);
      const body = sql.slice(start, nextFn === -1 ? sql.length : nextFn);
      expect(body).not.toMatch(/if not public\.is_store_admin\(/);
      expect(body).toMatch(/public\.can_manage_store_catalog\(/);
    }
  });

  it("as 2 policies de ESCRITA de storage.objects usam can_manage_store_catalog; a policy de LEITURA continua em is_store_member", () => {
    expect(sql).toContain("create policy product_images_storage_select_member");
    expect(sql).toContain("create policy product_images_storage_insert_admin");
    expect(sql).toContain("create policy product_images_storage_delete_admin");
    const readOccurrences = sql.match(/public\.is_store_member\(\(\(storage\.foldername\(name\)\)\[1\]\)::uuid\)/g) ?? [];
    const writeOccurrences = sql.match(/public\.can_manage_store_catalog\(\(\(storage\.foldername\(name\)\)\[1\]\)::uuid\)/g) ?? [];
    expect(readOccurrences.length).toBe(1);
    expect(writeOccurrences.length).toBe(2);
  });
});

describe("products — sem escrita direta de authenticated (BUG-CLAUDE-003-002)", () => {
  it("revoga insert/update/delete/truncate de authenticated em products", () => {
    expect(sql).toContain("revoke insert, update, delete, truncate on public.products from authenticated");
  });

  it("derruba as 3 policies de escrita antigas herdadas de 0001_init.sql", () => {
    expect(sql).toContain("drop policy if exists products_insert_admin on public.products");
    expect(sql).toContain("drop policy if exists products_update_admin on public.products");
    expect(sql).toContain("drop policy if exists products_delete_admin on public.products");
  });

  it("não concede nenhum INSERT/UPDATE/DELETE novo a authenticated em products nesta migração", () => {
    const grantLines = sql.split(";").filter((s) => /^\s*grant\s/.test(s.trimStart()) && /\bon\s+public\.products\b/.test(s));
    for (const line of grantLines) {
      if (/\bto\b[^;]*\bauthenticated\b/.test(line)) {
        expect(line).not.toMatch(/\binsert\b|\bupdate\b|\bdelete\b/);
      }
    }
  });
});

describe("categories — sem exclusão física, sem GRANT de delete para authenticated", () => {
  it("RLS habilitada, sem policy de DELETE", () => {
    expect(sql).toContain("alter table public.categories enable row level security");
    expect(sql).not.toMatch(/create policy[^;]*for delete[^;]*on public\.categories/);
  });

  it("revoga tudo antes de conceder; authenticated só recebe SELECT (toda escrita passa por RPC)", () => {
    expect(sql).toContain("revoke all on public.categories from public, anon, authenticated, service_role");
    expect(sql).toContain("grant select on public.categories to authenticated");
    expect(sql).not.toMatch(/grant[^;]*insert[^;]*on public\.categories to authenticated/);
    expect(sql).not.toMatch(/grant[^;]*delete[^;]*on public\.categories to authenticated/);
  });

  it("anon só SELECT, nunca INSERT/UPDATE/DELETE", () => {
    const grantLines = sql.split(";").filter((s) => /^\s*grant\s/.test(s.trimStart()) && /\bon\s+public\.categories\b/.test(s));
    for (const line of grantLines) {
      if (/\bto\b[^;]*\banon\b/.test(line)) {
        expect(line).not.toMatch(/\binsert\b|\bupdate\b|\bdelete\b/);
      }
    }
  });
});

describe("products — extensão em ALTER TABLE, nunca recriação (preserva a TASK-001)", () => {
  it("usa ALTER TABLE public.products, não CREATE TABLE (a tabela já existe desde 0001_init.sql)", () => {
    expect(sql).toContain("alter table public.products");
    expect(sql).not.toMatch(/create table public\.products/);
  });

  it("category_id é ON DELETE RESTRICT (categoria não pode desaparecer sob um produto)", () => {
    expect(sql).toMatch(/category_id uuid references public\.categories \(id\) on delete restrict/);
  });

  it("price_cents/stock nunca negativos (CHECK), status restrito a draft/published/archived", () => {
    expect(sql).toMatch(/price_cents integer not null default 0 check \(price_cents >= 0\)/);
    expect(sql).toMatch(/status text not null default 'draft' check \(status in \('draft', 'published', 'archived'\)\)/);
  });

  it("slug/sku são UNIQUE(store_id, slug|sku) — nullable para não quebrar fixtures antigas (TASK-001)", () => {
    expect(sql).toContain("add constraint products_store_slug_unique unique (store_id, slug)");
    expect(sql).toContain("add constraint products_store_sku_unique unique (store_id, sku)");
  });

  it("trigger valida que category_id pertence à mesma store_id do produto", () => {
    expect(sql).toContain("create trigger products_category_store_check");
    expect(sql).toContain("'category_store_mismatch'");
  });
});

describe("catálogo público — visível a QUALQUER visitante (anon ou autenticado sem vínculo), só linhas published/active/is_active (decisão explícita da TASK-003)", () => {
  // `to public` (não só `to anon`): um usuário autenticado mas sem
  // vínculo com a loja visitada precisa ver o catálogo público dela
  // igual a um anônimo — uma policy só `to anon` deixaria a rota
  // pública com 0 resultados para qualquer visitante logado que não
  // seja membro daquela loja específica (bug encontrado e corrigido
  // nesta rodada via smoke test real).
  it("stores: policy pública `to public`, restrita a status = active", () => {
    expect(sql).toMatch(/create policy stores_select_public[\s\S]*?to public[\s\S]*?using \(status = 'active'\)/);
    expect(sql).toContain("grant select on public.stores to anon");
  });

  it("categories: policy pública `to public`, restrita a is_active e loja active", () => {
    expect(sql).toMatch(/create policy categories_select_public[\s\S]*?to public/);
    expect(sql).toMatch(/is_active\s*\n\s*and exists \(select 1 from public\.stores s where s\.id = store_id and s\.status = 'active'\)/);
  });

  it("products: policy pública `to public`, restrita a status published e loja active", () => {
    expect(sql).toMatch(/create policy products_select_public[\s\S]*?to public/);
    expect(sql).toMatch(/status = 'published'\s*\n\s*and exists \(select 1 from public\.stores s where s\.id = store_id and s\.status = 'active'\)/);
  });

  it("product_images: policy pública `to public`", () => {
    expect(sql).toMatch(/create policy product_images_select_public[\s\S]*?to public/);
  });

  it("nenhuma policy pública concede INSERT/UPDATE/DELETE a anon em nenhuma tabela de catálogo", () => {
    const anonGrantLines = sql.split(";").filter((s) => /\bto\s+anon\b/.test(s) && /^\s*grant\s/.test(s.trimStart()));
    for (const line of anonGrantLines) {
      expect(line).not.toMatch(/\binsert\b|\bupdate\b|\bdelete\b/);
    }
  });
});

describe("estoque — ajuste atômico, único caminho de escrita de products.stock", () => {
  it("catalog_adjust_stock usa o próprio WHERE como compare-and-swap (stock + delta >= 0), nunca SELECT-depois-UPDATE", () => {
    const fn = sql.slice(
      sql.indexOf("create or replace function public.catalog_adjust_stock"),
      sql.indexOf("comment on function public.catalog_adjust_stock"),
    );
    expect(fn).toContain("set stock = stock + p_delta");
    expect(fn).toContain("where id = p_product_id\n    and stock + p_delta >= 0");
    expect(fn).toContain("'stock_would_be_negative'");
  });

  it("exige can_manage_store_catalog(v_store_id) e motivo não vazio antes de tocar a linha", () => {
    const fn = sql.slice(
      sql.indexOf("create or replace function public.catalog_adjust_stock"),
      sql.indexOf("comment on function public.catalog_adjust_stock"),
    );
    expect(fn).toContain("if not public.can_manage_store_catalog(v_store_id) then");
    expect(fn).toContain("'reason_required'");
  });

  it("EXECUTE só para authenticated (a própria função reautoriza via is_store_admin internamente)", () => {
    expect(sql).toContain(
      "grant execute on function public.catalog_adjust_stock(uuid, integer, text, text) to authenticated",
    );
  });
});

describe("imagens — bucket público, escrita protegida por RLS real em storage.objects", () => {
  it("insere o bucket product-images como público, com limite de tamanho e MIME types", () => {
    expect(sql).toMatch(/insert into storage\.buckets \(id, name, public, file_size_limit, allowed_mime_types\)/);
    expect(sql).toContain("values ('product-images', 'product-images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])");
  });

  it("revoga TRUNCATE de anon/authenticated em storage.objects/buckets (mesma classe de risco da TASK-001)", () => {
    expect(sql).toContain("revoke truncate on storage.objects from anon, authenticated");
    expect(sql).toContain("revoke truncate on storage.buckets from anon, authenticated");
  });

  it("revoga TUDO de anon em storage.objects — leitura pública passa pelo endpoint de bucket público, não pelo papel anon", () => {
    expect(sql).toContain("revoke all on storage.objects from anon");
  });

  it("índice único parcial garante no máximo uma capa por produto", () => {
    expect(sql).toContain("create unique index product_images_one_cover_per_product");
    expect(sql).toContain("on public.product_images (product_id)\n  where is_cover");
  });

  it("trigger de inserção bloqueia a 6a imagem (max_images_reached)", () => {
    expect(sql).toContain("create trigger product_images_insert_check");
    expect(sql).toContain("'max_images_reached'");
    expect(sql).toContain("v_count >= 5");
  });

  it("catalog_add_product_image trava a linha do produto (for update) antes de contar imagens — fecha BUG-CLAUDE-003-003 (race no limite de 5 sob concorrência)", () => {
    const fn = sql.slice(
      sql.indexOf("create or replace function public.catalog_add_product_image"),
      sql.indexOf("comment on function public.catalog_add_product_image"),
    );
    expect(fn).toContain("select store_id into v_store_id from public.products where id = p_product_id for update");
    const lockIndex = fn.indexOf("for update");
    const countIndex = fn.indexOf("select count(*)");
    expect(lockIndex).toBeGreaterThan(-1);
    expect(countIndex).toBeGreaterThan(lockIndex);
  });
});

describe("todas as funções catalog_* são SECURITY DEFINER com search_path vazio, revogadas de PUBLIC", () => {
  it("nenhuma função catalog_* fica acessível sem um GRANT explícito", () => {
    const catalogFunctionNames = [
      "catalog_create_category",
      "catalog_update_category",
      "catalog_set_category_active",
      "catalog_create_product",
      "catalog_update_product",
      "catalog_set_product_status",
      "catalog_adjust_stock",
      "catalog_add_product_image",
      "catalog_remove_product_image",
      "catalog_set_cover_image",
      "catalog_move_product_image",
    ];
    for (const name of catalogFunctionNames) {
      const revokeRegex = new RegExp(`revoke all on function public\\.${name}\\([^;]*\\) from public`);
      expect(sql).toMatch(revokeRegex);
    }
  });
});

describe("audit_log_action_check — só ALARGA (nunca estreita)", () => {
  it("todos os valores anteriores permanecem, os 12 eventos de catálogo são adicionados", () => {
    const constraintStmt = sql.slice(
      sql.indexOf("alter table public.audit_log\n  drop constraint audit_log_action_check"),
      sql.indexOf("comment on constraint audit_log_action_check"),
    );
    const expectedActions = [
      "signup_completed",
      "email_verification_completed",
      "password_recovery_requested",
      "password_recovery_grant_issued",
      "password_recovery_authorization_claimed",
      "password_recovery_completed",
      "password_recovery_revoked",
      "store_created",
      "owner_assigned",
      "plan_selected",
      "onboarding_completed",
      "access_denied",
      "category_created",
      "category_updated",
      "category_archived",
      "product_created",
      "product_updated",
      "product_published",
      "product_unpublished",
      "product_archived",
      "product_stock_adjusted",
      "product_image_added",
      "product_image_removed",
      "product_cover_changed",
    ];
    for (const action of expectedActions) {
      expect(constraintStmt).toContain(`'${action}'`);
    }
  });
});
