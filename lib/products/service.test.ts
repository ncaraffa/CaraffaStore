import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStoreRepository } from "@/lib/data/memory-repository";
import { DuplicateProductNameError, type StoreRepository } from "@/lib/data/repository";
import { ForbiddenTenantError } from "@/lib/tenant/context";
import {
  FIXTURE_STORES,
  FIXTURE_USERS,
  cloneFixtures,
} from "@/lib/data/fixtures";
import { createProductForStore, listProductsForStore } from "./service";

/**
 * Proves the isolation matrix from docs/TESTING.md against Loja A
 * (Mercado Aurora / store-a) and Loja B (Empório Horizonte / store-b).
 *
 * This is the server-side authorization layer (defense in depth #1).
 * The matching RLS policies (defense in depth #2, supabase/migrations/
 * 0001_init.sql) could not be exercised against a live Postgres in this
 * environment — see supabase/tests/isolation_check.sql and
 * docs/HANDOFF.md for exact QA instructions to validate that layer too.
 */
describe("isolamento Loja A x Loja B", () => {
  let repository: StoreRepository;

  beforeEach(() => {
    repository = new MemoryStoreRepository(cloneFixtures());
  });

  it("Admin A lê produtos da Loja A — permitido", async () => {
    const products = await listProductsForStore({
      repository,
      userId: FIXTURE_USERS.adminA.id,
      storeSlug: FIXTURE_STORES.storeA.slug,
    });
    expect(products.map((p) => p.name)).toEqual(["Café Aurora"]);
  });

  it("Admin A cria/altera produto na Loja A — permitido", async () => {
    const product = await createProductForStore({
      repository,
      userId: FIXTURE_USERS.adminA.id,
      storeSlug: FIXTURE_STORES.storeA.slug,
      input: { name: "Pão Aurora", stock: 10 },
    });
    expect(product.storeId).toBe(FIXTURE_STORES.storeA.id);
  });

  it("Admin A não lê produtos da Loja B — negado", async () => {
    await expect(
      listProductsForStore({
        repository,
        userId: FIXTURE_USERS.adminA.id,
        storeSlug: FIXTURE_STORES.storeB.slug,
      }),
    ).rejects.toBeInstanceOf(ForbiddenTenantError);
  });

  it("Admin A não altera/cria produto na Loja B — negado", async () => {
    await expect(
      createProductForStore({
        repository,
        userId: FIXTURE_USERS.adminA.id,
        storeSlug: FIXTURE_STORES.storeB.slug,
        input: { name: "Produto Forjado", stock: 1 },
      }),
    ).rejects.toBeInstanceOf(ForbiddenTenantError);
  });

  it("Admin B não lê estoque/produtos da Loja A — negado", async () => {
    await expect(
      listProductsForStore({
        repository,
        userId: FIXTURE_USERS.adminB.id,
        storeSlug: FIXTURE_STORES.storeA.slug,
      }),
    ).rejects.toBeInstanceOf(ForbiddenTenantError);
  });

  it("Admin B não altera estoque da Loja A — negado", async () => {
    await expect(
      createProductForStore({
        repository,
        userId: FIXTURE_USERS.adminB.id,
        storeSlug: FIXTURE_STORES.storeA.slug,
        input: { name: "Produto Forjado B em A", stock: 1 },
      }),
    ).rejects.toBeInstanceOf(ForbiddenTenantError);
  });

  it("Anônimo (sem sessão) não acessa painel — negado", async () => {
    await expect(
      listProductsForStore({
        repository,
        userId: null,
        storeSlug: FIXTURE_STORES.storeA.slug,
      }),
    ).rejects.toThrow(/Autenticação necessária/);
  });

  it("Cliente autenticado sem vínculo de staff não acessa painel — negado", async () => {
    await expect(
      listProductsForStore({
        repository,
        userId: FIXTURE_USERS.clienteA.id,
        storeSlug: FIXTURE_STORES.storeA.slug,
      }),
    ).rejects.toThrow(/não encontrada ou sem acesso/);
  });

  it("store_id/slug forjado (loja inexistente) é rejeitado com a mesma mensagem de 'sem acesso' (evita enumeração de lojas reais)", async () => {
    await expect(
      listProductsForStore({
        repository,
        userId: FIXTURE_USERS.adminA.id,
        storeSlug: "store-inexistente-forjada",
      }),
    ).rejects.toThrow(/não encontrada ou sem acesso/);
  });

  it("chamar a API da Loja A com identidade autorizada apenas para B é negado", async () => {
    // Admin B tentando usar a rota/slug de A — equivalente a "executar
    // função/API de A com ID de B" na matriz de testes.
    await expect(
      createProductForStore({
        repository,
        userId: FIXTURE_USERS.adminB.id,
        storeSlug: FIXTURE_STORES.storeA.slug,
        input: { name: "Tentativa Cross-Tenant", stock: 1 },
      }),
    ).rejects.toBeInstanceOf(ForbiddenTenantError);
  });

  it("qualquer store_id extra enviado pelo cliente no payload é ignorado", async () => {
    const forgedInput = {
      name: "Produto Com Store Id Forjado",
      stock: 1,
      storeId: FIXTURE_STORES.storeB.id,
    };
    const product = await createProductForStore({
      repository,
      userId: FIXTURE_USERS.adminA.id,
      storeSlug: FIXTURE_STORES.storeA.slug,
      input: forgedInput,
    });
    // Mesmo com storeId de B no payload, o produto é criado em A —
    // porque createProductForStore nunca lê esse campo.
    expect(product.storeId).toBe(FIXTURE_STORES.storeA.id);
  });

  it("Loja A e Loja B podem usar o mesmo nome de produto sem colisão", async () => {
    const product = await createProductForStore({
      repository,
      userId: FIXTURE_USERS.adminA.id,
      storeSlug: FIXTURE_STORES.storeA.slug,
      input: { name: "Chá Horizonte", stock: 3 },
    });
    expect(product.storeId).toBe(FIXTURE_STORES.storeA.id);

    const productsA = await listProductsForStore({
      repository,
      userId: FIXTURE_USERS.adminA.id,
      storeSlug: FIXTURE_STORES.storeA.slug,
    });
    const productsB = await listProductsForStore({
      repository,
      userId: FIXTURE_USERS.adminB.id,
      storeSlug: FIXTURE_STORES.storeB.slug,
    });
    expect(productsA.map((p) => p.name).sort()).toEqual([
      "Café Aurora",
      "Chá Horizonte",
    ]);
    expect(productsB.map((p) => p.name)).toEqual(["Chá Horizonte"]);
  });

  it("nome de produto duplicado na mesma loja é rejeitado", async () => {
    await expect(
      createProductForStore({
        repository,
        userId: FIXTURE_USERS.adminA.id,
        storeSlug: FIXTURE_STORES.storeA.slug,
        input: { name: "Café Aurora", stock: 1 },
      }),
    ).rejects.toBeInstanceOf(DuplicateProductNameError);
  });
});
