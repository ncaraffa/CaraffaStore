import { getPlatformPlan, nextPlanAbove, type PlanKey } from "@/lib/billing/plans";

/**
 * Converte um limite de plano atingido em comunicação humana — nunca
 * "403 / LIMIT_EXCEEDED" (seção 34 do TASK-012).
 *
 * A regra de negócio é do banco; isto aqui é só a tradução para o
 * lojista. Por isso é uma função pura: recebe o plano vigente (derivado
 * no servidor) e devolve texto. Nenhuma decisão de autorização acontece
 * aqui — se esta camada mentir, o banco continua recusando.
 *
 * O texto sempre diz três coisas, nesta ordem:
 *   1. o que aconteceu, com o número real do plano ATUAL;
 *   2. o que o próximo plano oferece;
 *   3. o convite para o upgrade.
 * Quando já não há plano acima, o convite some — não faz sentido
 * oferecer upgrade a quem está no Profissional.
 */

export type QuotaKind = "products" | "images" | "stores" | "team" | "coupons";

export interface QuotaNotice {
  title: string;
  body: string;
  /** Ausente quando o lojista já está no plano mais alto. */
  upgradeTo?: { planKey: PlanKey; label: string };
}

const NUMBER_FORMAT = new Intl.NumberFormat("pt-BR");

function fmt(value: number): string {
  return NUMBER_FORMAT.format(value);
}

export function quotaNotice(kind: QuotaKind, planKey: PlanKey): QuotaNotice {
  const plan = getPlatformPlan(planKey);
  const next = nextPlanAbove(planKey);
  const e = plan.entitlements;
  const upgradeTo = next ? { planKey: next.planKey, label: next.label } : undefined;

  switch (kind) {
    case "products": {
      const body = next
        ? `Seu plano ${plan.label} permite até ${fmt(e.maxProducts)}. No ${next.label}, você pode cadastrar até ${fmt(next.entitlements.maxProducts)}.`
        : `Seu plano ${plan.label} permite até ${fmt(e.maxProducts)} produtos.`;
      return { title: `Você chegou ao limite de ${fmt(e.maxProducts)} produtos.`, body, upgradeTo };
    }

    case "images": {
      const atual =
        e.maxImagesPerProduct === 1
          ? "Este produto já possui a foto permitida pelo seu plano."
          : `Este produto já possui as ${fmt(e.maxImagesPerProduct)} fotos permitidas pelo seu plano.`;
      const body = next
        ? `${atual} No ${next.label}, cada produto pode ter até ${fmt(next.entitlements.maxImagesPerProduct)} fotos.`
        : atual;
      return {
        title:
          e.maxImagesPerProduct === 1
            ? `O ${plan.label} permite 1 foto por produto.`
            : `O ${plan.label} permite ${fmt(e.maxImagesPerProduct)} fotos por produto.`,
        body,
        upgradeTo,
      };
    }

    case "stores": {
      const atual = e.maxStores === 1 ? "O seu plano permite 1 loja." : `O seu plano permite ${fmt(e.maxStores)} lojas.`;
      // O upgrade só é oferecido quando ele realmente aumenta o limite —
      // Essencial e Crescimento têm 1 loja, então mandar alguém do
      // Essencial para o Crescimento "para ter mais lojas" seria mentira.
      const better = PLAN_WITH_MORE_STORES(planKey);
      const body = better
        ? `${atual} O ${better.label} permite administrar até ${fmt(better.entitlements.maxStores)} lojas.`
        : atual;
      return {
        title: atual,
        body,
        upgradeTo: better ? { planKey: better.planKey, label: better.label } : undefined,
      };
    }

    case "team": {
      const atual =
        e.maxTeamMembers === 1
          ? "Seu plano permite 1 usuário."
          : `Seu plano permite até ${fmt(e.maxTeamMembers)} usuários.`;
      const body = next
        ? `${atual} Adicione membros da equipe a partir do ${next.label}, com até ${fmt(next.entitlements.maxTeamMembers)} usuários.`
        : atual;
      return { title: atual, body, upgradeTo: next ? { planKey: next.planKey, label: next.label } : undefined };
    }

    case "coupons": {
      return {
        title: "Cupons estão disponíveis nos planos Crescimento e Profissional.",
        body: `Seu plano ${plan.label} não inclui cupons de desconto.`,
        upgradeTo: upgradeTo,
      };
    }
  }
}

/**
 * Primeiro plano que realmente oferece MAIS lojas que o atual. Evita a
 * sugestão inútil "vá para o Crescimento para ter mais lojas" quando
 * Essencial e Crescimento têm o mesmo limite de 1.
 */
function PLAN_WITH_MORE_STORES(planKey: PlanKey) {
  const current = getPlatformPlan(planKey);
  const candidates = [getPlatformPlan("essential"), getPlatformPlan("growth"), getPlatformPlan("professional")];
  return (
    candidates.find(
      (plan) => plan.tier > current.tier && plan.entitlements.maxStores > current.entitlements.maxStores,
    ) ?? null
  );
}

/**
 * Códigos de erro do banco que significam "limite de plano atingido".
 * Servem para a UI decidir mostrar um QuotaNotice em vez do texto
 * genérico de falha.
 */
export const QUOTA_ERROR_CODES: Record<string, QuotaKind> = {
  max_products_reached: "products",
  max_images_reached: "images",
  max_stores_reached: "stores",
  max_team_members_reached: "team",
  coupons_not_available: "coupons",
};

export function quotaKindForErrorCode(code: string): QuotaKind | null {
  return QUOTA_ERROR_CODES[code] ?? null;
}

/** Sinaliza suavemente quando o uso se aproxima do limite (seção 35). */
export function isNearLimit(used: number, limit: number): boolean {
  if (limit <= 0) return false;
  return used >= Math.ceil(limit * 0.8) && used < limit;
}
