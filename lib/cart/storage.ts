/**
 * Carrinho puramente client-side (localStorage), isolado por loja — a
 * chave inclui `storeSlug`, então o carrinho da Loja A nunca aparece nem
 * é lido/escrito junto com o da Loja B. Todo valor aqui (preço/nome) é
 * só para exibição local; o checkout revalida tudo no servidor
 * (lib/orders — nunca confia no que está salvo aqui).
 */
export interface CartItem {
  productId: string;
  name: string;
  slug: string | null;
  priceCents: number;
  quantity: number;
  /** Só para exibição no carrinho — nunca revalidada no checkout (que só
   *  confia em productId/quantity). Ausente em carrinhos salvos antes
   *  desta versão; `isValidItem` trata isso como válido (campo opcional). */
  imageUrl?: string | null;
}

export interface Cart {
  items: CartItem[];
}

const EMPTY_CART: Cart = { items: [] };

function cartKey(storeSlug: string): string {
  return `cart:${storeSlug}`;
}

export function cartEventName(storeSlug: string): string {
  return `cart-updated:${storeSlug}`;
}

function isValidItem(value: unknown): value is CartItem {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.productId === "string" &&
    item.productId.length > 0 &&
    typeof item.name === "string" &&
    (item.slug === null || typeof item.slug === "string") &&
    typeof item.priceCents === "number" &&
    Number.isFinite(item.priceCents) &&
    item.priceCents >= 0 &&
    typeof item.quantity === "number" &&
    Number.isInteger(item.quantity) &&
    item.quantity > 0 &&
    item.quantity <= 999 &&
    (item.imageUrl === undefined || item.imageUrl === null || typeof item.imageUrl === "string")
  );
}

export function readCart(storeSlug: string): Cart {
  if (typeof window === "undefined") return EMPTY_CART;
  try {
    const raw = window.localStorage.getItem(cartKey(storeSlug));
    if (!raw) return EMPTY_CART;
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null || !Array.isArray((parsed as Cart).items)) {
      return EMPTY_CART;
    }
    return { items: (parsed as Cart).items.filter(isValidItem) };
  } catch {
    return EMPTY_CART;
  }
}

export function writeCart(storeSlug: string, cart: Cart): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(cartKey(storeSlug), JSON.stringify(cart));
    // `storage` só dispara em OUTRAS abas — este evento próprio avisa
    // outros componentes na MESMA aba (ex.: contador do carrinho no
    // cabeçalho) sem precisar de um Context/Provider global.
    window.dispatchEvent(new Event(cartEventName(storeSlug)));
  } catch {
    // localStorage indisponível (modo privado/quota excedida) — o
    // carrinho simplesmente não persiste entre recarregamentos nesta
    // aba; não é um erro fatal para a navegação.
  }
}

export function clearCart(storeSlug: string): void {
  writeCart(storeSlug, EMPTY_CART);
}

/**
 * Snapshot memoizado para useSyncExternalStore (lib/cart/use-cart.ts).
 * `getSnapshot` precisa devolver a MESMA referência enquanto o conteúdo
 * bruto não mudar — devolver um array/objeto novo a cada chamada faria
 * useSyncExternalStore entrar em loop de re-render (Object.is nunca
 * bate). O cache é indexado pela string bruta do localStorage: só
 * reprocessa/realoca quando ela de fato muda.
 */
let cachedRaw: string | null | undefined;
let cachedStoreSlug: string | undefined;
let cachedItems: CartItem[] = EMPTY_CART.items;

export function getCartSnapshot(storeSlug: string): CartItem[] {
  if (typeof window === "undefined") return EMPTY_CART.items;
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(cartKey(storeSlug));
  } catch {
    raw = null;
  }
  if (raw === cachedRaw && storeSlug === cachedStoreSlug) {
    return cachedItems;
  }
  cachedRaw = raw;
  cachedStoreSlug = storeSlug;
  cachedItems = readCart(storeSlug).items;
  return cachedItems;
}

export function getServerCartSnapshot(): CartItem[] {
  return EMPTY_CART.items;
}
