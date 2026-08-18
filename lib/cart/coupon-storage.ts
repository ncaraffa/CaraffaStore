/**
 * Cupom aplicado no carrinho — client-side, isolado por loja, mesmo
 * padrão de lib/cart/storage.ts.
 *
 * Guarda SÓ o código digitado. Nunca o desconto, nunca o total: se o
 * navegador guardasse valores, mexer no localStorage viraria uma forma
 * de "aplicar" desconto. O preview é recalculado a cada leitura, e o
 * checkout recalcula tudo de novo no banco.
 */

function couponKey(storeSlug: string): string {
  return `cart-coupon:${storeSlug}`;
}

export function couponEventName(storeSlug: string): string {
  return `caraffa:cart-coupon:${storeSlug}`;
}

export function readAppliedCoupon(storeSlug: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(couponKey(storeSlug));
    if (!raw) return null;
    const trimmed = raw.trim();
    // Limite defensivo: o banco recusa qualquer coisa fora de 3..32, mas
    // não faz sentido carregar um payload gigante até lá.
    return trimmed.length > 0 && trimmed.length <= 64 ? trimmed : null;
  } catch {
    // localStorage indisponível (modo privado/quota) — o carrinho segue
    // funcionando sem cupom, que é degradação aceitável.
    return null;
  }
}

export function writeAppliedCoupon(storeSlug: string, code: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (code === null || code.trim() === "") {
      window.localStorage.removeItem(couponKey(storeSlug));
    } else {
      window.localStorage.setItem(couponKey(storeSlug), code.trim());
    }
    window.dispatchEvent(new CustomEvent(couponEventName(storeSlug)));
  } catch {
    // idem
  }
}

/**
 * Hook de leitura do cupom aplicado.
 *
 * useSyncExternalStore, não useEffect+setState: é a forma correta do
 * React de assinar um estado externo mutável como localStorage. Mesmo
 * padrão de lib/cart/use-cart.ts — evita a cascata de render do
 * "hidratar via efeito" e mantém as abas em sincronia.
 */
export function subscribeToCoupon(storeSlug: string, callback: () => void): () => void {
  const eventName = couponEventName(storeSlug);
  window.addEventListener(eventName, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(eventName, callback);
    window.removeEventListener("storage", callback);
  };
}

/** No servidor não existe cupom aplicado — o snapshot inicial é sempre nulo. */
export function getServerCouponSnapshot(): string | null {
  return null;
}
