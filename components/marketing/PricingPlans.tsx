import Link from "next/link";
import { PLATFORM_PLANS, formatPlanPrice, type PlanKey, type PlatformPlan } from "@/lib/billing/plans";
import { Button } from "@/components/ui/Button";
import { IconCheck } from "@/components/ui/icons";
import styles from "./PricingPlans.module.css";

/* ============================================================
   Planos

   ATENÇÃO — isto mudou na TASK-012.

   Até então os três planos eram funcionalmente idênticos e esta
   tela dizia isso: "o software é o mesmo, o que muda é o
   acompanhamento". Não é mais verdade. Agora existem entitlements
   REAIS, aplicados no banco: produtos, fotos por produto, lojas,
   usuários da equipe e cupons.

   Por isso os bullets voltaram a falar de recurso — porque agora
   há recurso de verdade por trás de cada um.

   Os NÚMEROS não são digitados aqui: saem de plan.entitlements,
   a mesma fonte que o banco usa para recusar a criação do 76º
   produto. Se um limite mudar em platform_plans, o card muda
   junto — não existe chance de a landing prometer 75 e o backend
   permitir outra coisa.

   O preço também vem de plan.priceCents. Nunca escreva "R$ 30"
   literal numa tela.
   ============================================================ */

interface PlanCopy {
  /** Uma linha que diz para QUEM o plano é. */
  fit: string;
  /** Bullets além dos limites numéricos — atendimento e recursos booleanos. */
  extras: string[];
  cta: string;
}

const PLAN_COPY: Record<PlanKey, PlanCopy> = {
  essential: {
    fit: "Para começar a vender online.",
    extras: ["Pedidos ilimitados", "Pix e controle de estoque"],
    cta: "Começar com Essencial",
  },
  growth: {
    fit: "Para quem quer vender mais e ter mais recursos.",
    extras: ["Cupons de desconto", "Suporte prioritário", "Ajuda na configuração"],
    cta: "Escolher Crescimento",
  },
  professional: {
    fit: "Para operações maiores.",
    extras: ["Cupons de desconto", "Acompanhamento na implantação"],
    cta: "Escolher Profissional",
  },
};

const nf = new Intl.NumberFormat("pt-BR");

/**
 * Os limites viram frase. Deliberadamente curto — o card é comercial,
 * não uma tabela de especificação (a comparação completa fica logo
 * abaixo, para quem quiser).
 */
function limitBullets(plan: PlatformPlan): string[] {
  const e = plan.entitlements;
  const bullets = [
    plan.planKey === "professional"
      ? `Até ${nf.format(e.maxProducts)} produtos por loja`
      : `Até ${nf.format(e.maxProducts)} produtos`,
    e.maxImagesPerProduct === 1 ? "1 foto por produto" : `Até ${e.maxImagesPerProduct} fotos por produto`,
  ];

  // Só vale a pena falar de lojas quando o plano oferece mais de uma —
  // "1 loja" no Crescimento seria destaque para uma limitação.
  if (e.maxStores > 1) bullets.push(`Até ${e.maxStores} lojas`);
  else if (plan.planKey === "essential") bullets.push("1 loja");

  bullets.push(e.maxTeamMembers === 1 ? "1 usuário" : `Até ${e.maxTeamMembers} usuários`);
  return bullets;
}

function PlanCard({ plan }: { plan: PlatformPlan }) {
  const copy = PLAN_COPY[plan.planKey];
  const bullets = [...limitBullets(plan), ...copy.extras];

  return (
    <article
      className={styles.card}
      data-featured={plan.featured || undefined}
      data-reveal="lift"
      style={{ "--reveal-delay": `${(plan.tier - 1) * 80}ms` } as React.CSSProperties}
    >
      {plan.featured && <span className={styles.badge}>Recomendado</span>}

      <header className={styles.head}>
        {/* Linha de nível — o mesmo motivo do símbolo da marca. */}
        <span className={styles.level} aria-hidden="true">
          <span data-on={plan.tier >= 1 || undefined} />
          <span data-on={plan.tier >= 2 || undefined} />
          <span data-on={plan.tier >= 3 || undefined} />
        </span>
        <h3 className={styles.name}>{plan.label}</h3>
        <p className={styles.price}>
          <span className={styles.priceValue}>{formatPlanPrice(plan)}</span>
          <span className={styles.period}>/mês</span>
        </p>
        <p className={styles.fit}>{copy.fit}</p>
      </header>

      <Link href="/signup" className={styles.cta}>
        <Button as="span" size="lg" fullWidth variant={plan.featured ? "primary" : "outline"}>
          {copy.cta}
        </Button>
      </Link>

      <ul className={styles.bullets}>
        {bullets.map((bullet) => (
          <li key={bullet}>
            <IconCheck />
            {bullet}
          </li>
        ))}
      </ul>
    </article>
  );
}

export function PricingPlans() {
  return (
    <div className={styles.wrap}>
      <div className={styles.grid}>
        {PLATFORM_PLANS.map((plan) => (
          <PlanCard key={plan.planKey} plan={plan} />
        ))}
      </div>

      {/*
        Duas afirmações que podemos fazer porque são verdade no código:
        não existe limite de pedidos/clientes em nenhum plano, e a
        CaraffaStore não retém percentual das vendas. NÃO dizemos "sem
        taxas" — o Mercado Pago cobra as tarifas dele, e prometer o
        contrário seria falso.
      */}
      <p className={styles.footnote} data-reveal>
        Pedidos e clientes ilimitados em todos os planos, e a CaraffaStore não cobra comissão sobre suas vendas
        (as tarifas do Mercado Pago são à parte). Sem fidelidade — dá para trocar de plano quando quiser.
      </p>
    </div>
  );
}
