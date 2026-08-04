import type { Membership, Product, Store } from "./repository";

/**
 * Fixture data mirroring docs/TESTING.md exactly (Loja A — Mercado
 * Aurora, Loja B — Empório Horizonte). IDs are fixed, fake UUIDs so
 * tests and the local seed script agree on the same identities.
 *
 * Fictício. Nunca usar estes e-mails/UUIDs em ambiente real.
 */

export const FIXTURE_USERS = {
  adminA: {
    id: "aaaaaaaa-0000-4000-8000-000000000001",
    email: "admin-a@example.test",
  },
  clienteA: {
    id: "aaaaaaaa-0000-4000-8000-000000000002",
    email: "cliente-a@example.test",
  },
  adminB: {
    id: "bbbbbbbb-0000-4000-8000-000000000001",
    email: "admin-b@example.test",
  },
  clienteB: {
    id: "bbbbbbbb-0000-4000-8000-000000000002",
    email: "cliente-b@example.test",
  },
} as const;

export const FIXTURE_STORES: { storeA: Store; storeB: Store } = {
  storeA: {
    id: "10000000-0000-4000-8000-000000000001",
    slug: "store-a",
    name: "Mercado Aurora",
    status: "active",
  },
  storeB: {
    id: "20000000-0000-4000-8000-000000000001",
    slug: "store-b",
    name: "Empório Horizonte",
    status: "active",
  },
};

/**
 * Somente admin-a/admin-b são membros (staff) das lojas — cliente-a e
 * cliente-b representam usuários autenticados como clientes finais, sem
 * vínculo de staff em nenhuma loja, propositalmente. Isso prova que "estar
 * logado" não é suficiente: autorização exige vínculo explícito em
 * store_members.
 */
export const FIXTURE_MEMBERSHIPS: Membership[] = [
  {
    userId: FIXTURE_USERS.adminA.id,
    storeId: FIXTURE_STORES.storeA.id,
    role: "admin",
  },
  {
    userId: FIXTURE_USERS.adminB.id,
    storeId: FIXTURE_STORES.storeB.id,
    role: "admin",
  },
];

export const FIXTURE_PRODUCTS: Product[] = [
  {
    id: "p0000000-0000-4000-8000-000000000001",
    storeId: FIXTURE_STORES.storeA.id,
    name: "Café Aurora",
    stock: 20,
  },
  {
    id: "p0000000-0000-4000-8000-000000000002",
    storeId: FIXTURE_STORES.storeB.id,
    name: "Chá Horizonte",
    stock: 15,
  },
];

export function cloneFixtures() {
  return {
    stores: [FIXTURE_STORES.storeA, FIXTURE_STORES.storeB].map((s) => ({
      ...s,
    })),
    memberships: FIXTURE_MEMBERSHIPS.map((m) => ({ ...m })),
    products: FIXTURE_PRODUCTS.map((p) => ({ ...p })),
  };
}
