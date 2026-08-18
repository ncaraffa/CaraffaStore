/**
 * Tradução entre o que o comerciante digita e o que o banco guarda.
 *
 * O banco é inteiro em tudo: percentual em BASIS POINTS (1000 = 10%) e
 * dinheiro em CENTAVOS. O comerciante nunca vê nem digita isso — ele
 * escreve "10" e "20,00". Toda a conversão vive aqui, num lugar só, para
 * que nenhuma tela invente a sua própria.
 */

export type CouponDiscountType = "percentage" | "fixed_amount";

/** Estado apresentável, derivado — não é coluna no banco. */
export type CouponStatus = "active" | "inactive" | "scheduled" | "expired";

export interface CouponView {
  id: string;
  code: string;
  discountType: CouponDiscountType;
  discountValue: number;
  minimumOrderCents: number | null;
  maximumDiscountCents: number | null;
  startsAt: string | null;
  expiresAt: string | null;
  maxUses: number | null;
  usedCount: number;
  active: boolean;
  createdAt: string;
}

/**
 * "10" ou "10,5" -> basis points. Aceita vírgula (teclado brasileiro).
 * Retorna null quando não é um percentual utilizável — quem decide o que
 * fazer com isso é o formulário.
 */
export function percentToBasisPoints(input: string): number | null {
  const normalized = input.trim().replace(",", ".");
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(normalized)) return null;
  const value = Number(normalized);
  if (!Number.isFinite(value) || value <= 0 || value > 100) return null;
  // Math.round evita 10.1 * 100 = 1009.9999999999999.
  return Math.round(value * 100);
}

export function basisPointsToPercent(bp: number): string {
  const pct = bp / 100;
  return Number.isInteger(pct) ? String(pct) : pct.toFixed(2).replace(".", ",");
}

/** "20", "20,00" ou "R$ 20,00" -> centavos. */
export function currencyToCents(input: string): number | null {
  const cleaned = input.trim().replace(/^R\$\s*/i, "").replace(/\./g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

export function centsToCurrencyInput(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}

export function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/**
 * Como o desconto é descrito numa linha: "10% de desconto" ou
 * "R$ 20,00 de desconto".
 */
export function describeDiscount(coupon: Pick<CouponView, "discountType" | "discountValue">): string {
  return coupon.discountType === "percentage"
    ? `${basisPointsToPercent(coupon.discountValue)}% de desconto`
    : `${formatCents(coupon.discountValue)} de desconto`;
}

/**
 * Estado DERIVADO de active + datas. Deliberadamente não existe coluna
 * "status" no banco: um cupom não deixa de ser `active` só porque a data
 * passou — isso criaria um segundo estado para manter em sincronia (e um
 * cron para virar a chave). A validade é calculada onde é lida.
 */
export function couponStatus(
  coupon: Pick<CouponView, "active" | "startsAt" | "expiresAt">,
  now: Date = new Date(),
): CouponStatus {
  if (!coupon.active) return "inactive";
  if (coupon.expiresAt && new Date(coupon.expiresAt) <= now) return "expired";
  if (coupon.startsAt && new Date(coupon.startsAt) > now) return "scheduled";
  return "active";
}

export const COUPON_STATUS_LABEL: Record<CouponStatus, string> = {
  active: "Ativo",
  inactive: "Inativo",
  scheduled: "Agendado",
  expired: "Expirado",
};

/** "34 / 200 utilizações" ou "34 utilizações · ilimitado". */
export function describeUsage(coupon: Pick<CouponView, "usedCount" | "maxUses">): string {
  if (coupon.maxUses === null) {
    return `${coupon.usedCount.toLocaleString("pt-BR")} · utilizações ilimitadas`;
  }
  return `${coupon.usedCount.toLocaleString("pt-BR")} / ${coupon.maxUses.toLocaleString("pt-BR")} utilizações`;
}

export function describeValidity(coupon: Pick<CouponView, "startsAt" | "expiresAt">): string | null {
  const fmt = (iso: string) =>
    new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });

  if (coupon.startsAt && coupon.expiresAt) return `${fmt(coupon.startsAt)} até ${fmt(coupon.expiresAt)}`;
  if (coupon.expiresAt) return `Válido até ${fmt(coupon.expiresAt)}`;
  if (coupon.startsAt) return `A partir de ${fmt(coupon.startsAt)}`;
  return null;
}

/**
 * Normalização só para conforto visual do campo. A verdade continua
 * sendo a do banco (coupon_normalize_code + CHECK do alfabeto): se o
 * comerciante colar algo fora do permitido, quem recusa é a RPC.
 */
export function normalizeCodeForDisplay(input: string): string {
  return input.trim().toUpperCase();
}
