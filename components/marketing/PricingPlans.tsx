import Link from "next/link";
import { PLATFORM_PLANS, type PlatformPlan } from "@/lib/billing/plans";
import { Button } from "@/components/ui/Button";
import { IconCheck } from "@/components/ui/icons";
import styles from "./PricingPlans.module.css";

/* ============================================================
   Planos

   O software é o MESMO nos três planos — e continua sendo, no
   código e no banco: não existe entitlement, quota ou gating por
   `plan_code` em lugar nenhum, e nada aqui cria um. O que
   diferencia os planos é o nível de ACOMPANHAMENTO humano
   (suporte, ajuda na configuração, revisão da loja): um
   compromisso comercial do operador, não um recurso do sistema.

   Por isso os bullets de Crescimento e Profissional nunca falam
   em funcionalidade liberada — falam em atendimento. Um bullet
   que prometa recurso de software seria mentira, porque nenhum
   código o entregaria.

   Preço e rótulo saem de lib/billing/plans.ts, a mesma fonte do
   onboarding e da cobrança. `code` é o identificador técnico (o
   Profissional é 80 por herança de banco, cobrando R$ 70): nunca
   exiba `code` como preço.
   ============================================================ */

interface PlanCopy {
  /** Uma linha que diz para QUEM o plano é. */
  fit: string;
  /** Título da lista — deixa a herança entre planos explícita. */
  listTitle: string;
  bullets: string[];
  cta: string;
}

const PLAN_COPY: Record<number, PlanCopy> = {
  30: {
    fit: "Para quem quer configurar e tocar a própria loja.",
    listTitle: "Inclui",
    bullets: [
      "A CaraffaStore completa, sem recurso bloqueado",
      "Produtos, fotos e categorias sem limite artificial",
      "Pedidos e estoque no painel, com baixa automática",
      "Cobrança por Pix em cada pedido",
      "Link exclusivo da sua loja para compartilhar",
      "Suporte por e-mail",
    ],
    cta: "Começar com Essencial",
  },
  50: {
    fit: "Para quem quer começar mais rápido, com acompanhamento.",
    listTitle: "Tudo do Essencial, e mais",
    bullets: [
      "Suporte prioritário",
      "Ajuda na configuração inicial da loja",
      "Orientação para deixar catálogo e informações no ponto",
      "Revisão da loja depois de configurada, antes de você divulgar",
    ],
    cta: "Escolher Crescimento",
  },
  80: {
    fit: "Para quem prefere implantação acompanhada de perto.",
    listTitle: "Tudo do Crescimento, e mais",
    bullets: [
      "Atendimento com prioridade máxima",
      "Acompanhamento próximo durante a implantação",
      "Auxílio personalizado na organização inicial da loja",
      "Revisão comercial e visual da sua loja e do catálogo",
    ],
    cta: "Escolher Profissional",
  },
};

function PlanCard({ plan }: { plan: PlatformPlan }) {
  const copy = PLAN_COPY[plan.code];
  if (!copy) return null;

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
          <span className={styles.currency}>R$</span>
          <span className={styles.priceValue}>{plan.price}</span>
          <span className={styles.period}>/mês</span>
        </p>
        <p className={styles.fit}>{copy.fit}</p>
      </header>

      <Link href="/signup" className={styles.cta}>
        <Button as="span" size="lg" fullWidth variant={plan.featured ? "primary" : "outline"}>
          {copy.cta}
        </Button>
      </Link>

      <p className={styles.listTitle}>{copy.listTitle}</p>
      <ul className={styles.bullets}>
        {copy.bullets.map((bullet) => (
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
          <PlanCard key={plan.code} plan={plan} />
        ))}
      </div>

      <p className={styles.footnote} data-reveal>
        Todos os planos usam a plataforma completa — o que muda é o nível de acompanhamento. Sem fidelidade, e dá
        para trocar de plano falando com a gente.
      </p>
    </div>
  );
}
