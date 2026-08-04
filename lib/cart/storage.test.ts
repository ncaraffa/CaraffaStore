import { beforeEach, describe, expect, it } from "vitest";
import { clearCart, getCartSnapshot, readCart, writeCart } from "./storage";

/**
 * vitest.config.mts roda em ambiente "node" (sem jsdom) para o resto do
 * projeto — não vale a pena adicionar jsdom como dependência só para
 * este arquivo. storage.ts só lê `window.localStorage`/`window.
 * dispatchEvent` dentro do CORPO de cada função (nunca no topo do
 * módulo), então este stub em memória, atribuído antes de qualquer
 * `it()` rodar, é suficiente — a ordem de avaliação de import não
 * importa aqui, só a ordem de CHAMADA das funções.
 */
class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  clear(): void {
    this.store.clear();
  }
}

const memoryStorage = new MemoryStorage();
(globalThis as unknown as { window: unknown }).window = {
  localStorage: memoryStorage,
  dispatchEvent: () => true,
};

const STORE_A = "store-a";
const STORE_B = "store-b";

beforeEach(() => {
  memoryStorage.clear();
});

describe("readCart/writeCart — isolamento por loja", () => {
  it("carrinho vazio por padrão", () => {
    expect(readCart(STORE_A)).toEqual({ items: [] });
  });

  it("escreve e lê de volta", () => {
    writeCart(STORE_A, { items: [{ productId: "p1", name: "Produto", slug: "produto", priceCents: 100, quantity: 2 }] });
    expect(readCart(STORE_A).items).toHaveLength(1);
    expect(readCart(STORE_A).items[0]).toMatchObject({ productId: "p1", quantity: 2 });
  });

  it("carrinho da Loja A nunca aparece na Loja B (chaves isoladas)", () => {
    writeCart(STORE_A, { items: [{ productId: "p1", name: "A", slug: "a", priceCents: 100, quantity: 1 }] });
    expect(readCart(STORE_B).items).toEqual([]);
    expect(readCart(STORE_A).items).toHaveLength(1);
  });

  it("clearCart só limpa a loja informada", () => {
    writeCart(STORE_A, { items: [{ productId: "p1", name: "A", slug: "a", priceCents: 100, quantity: 1 }] });
    writeCart(STORE_B, { items: [{ productId: "p2", name: "B", slug: "b", priceCents: 200, quantity: 1 }] });
    clearCart(STORE_A);
    expect(readCart(STORE_A).items).toEqual([]);
    expect(readCart(STORE_B).items).toHaveLength(1);
  });

  it("ignora itens malformados salvos diretamente (estrutura inesperada)", () => {
    memoryStorage.setItem(`cart:${STORE_A}`, JSON.stringify({ items: [{ productId: "p1" }, "lixo", null] }));
    expect(readCart(STORE_A).items).toEqual([]);
  });

  it("JSON inválido no localStorage não lança, devolve carrinho vazio", () => {
    memoryStorage.setItem(`cart:${STORE_A}`, "{ isto não é json");
    expect(readCart(STORE_A)).toEqual({ items: [] });
  });

  it("rejeita quantidade zero/negativa/decimal ao validar item salvo", () => {
    memoryStorage.setItem(
      `cart:${STORE_A}`,
      JSON.stringify({
        items: [
          { productId: "p1", name: "A", slug: "a", priceCents: 100, quantity: 0 },
          { productId: "p2", name: "B", slug: "b", priceCents: 100, quantity: -1 },
          { productId: "p3", name: "C", slug: "c", priceCents: 100, quantity: 1.5 },
          { productId: "p4", name: "D", slug: "d", priceCents: 100, quantity: 3 },
        ],
      }),
    );
    const items = readCart(STORE_A).items;
    expect(items).toHaveLength(1);
    expect(items[0]?.productId).toBe("p4");
  });
});

describe("getCartSnapshot — estabilidade de referência (useSyncExternalStore)", () => {
  it("devolve a MESMA referência entre chamadas sem escrita no meio", () => {
    writeCart(STORE_A, { items: [{ productId: "p1", name: "A", slug: "a", priceCents: 100, quantity: 1 }] });
    const first = getCartSnapshot(STORE_A);
    const second = getCartSnapshot(STORE_A);
    expect(first).toBe(second);
  });

  it("devolve uma referência NOVA depois de uma escrita real", () => {
    writeCart(STORE_A, { items: [{ productId: "p1", name: "A", slug: "a", priceCents: 100, quantity: 1 }] });
    const first = getCartSnapshot(STORE_A);
    writeCart(STORE_A, { items: [{ productId: "p1", name: "A", slug: "a", priceCents: 100, quantity: 2 }] });
    const second = getCartSnapshot(STORE_A);
    expect(first).not.toBe(second);
    expect(second[0]?.quantity).toBe(2);
  });
});
