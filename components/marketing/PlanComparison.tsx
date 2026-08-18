import { PLATFORM_PLANS, formatPlanPrice, type PlatformPlan } from "@/lib/billing/plans";
import { IconCheck, IconClose } from "@/components/ui/icons";
import styles from "./PlanComparison.module.css";

/* ============================================================
   Comparação de planos

   Duas apresentações do MESMO dado, escolhidas por CSS:

     desktop  -> tabela, que é onde tabela funciona bem
     mobile   -> um bloco por plano, empilhado

   Não é uma tabela desktop espremida em 375px. Uma tabela de 4
   colunas nessa largura ou estoura a viewport ou vira texto de 9px
   — as duas coisas que o TASK proíbe. Renderizar as duas formas
   custa alguns nós a mais no DOM e resolve o problema de vez, sem
   JavaScript e sem media query dependente de altura de linha.

   TODOS os números vêm de plan.entitlements. Nenhum valor é
   digitado aqui: é a mesma fonte que o banco usa para recusar o
   76º produto.
   ============================================================ */

const nf = new Intl.NumberFormat("pt-BR");

type Cell = string | boolean;

interface Row {
  label: string;
  value: (plan: PlatformPlan) => Cell;
}

interface Group {
  title: string;
  rows: Row[];
}

const GROUPS: Group[] = [
  {
    title: "Catálogo",
    rows: [
      { label: "Produtos por loja", value: (p) => `Até ${nf.format(p.entitlements.maxProducts)}` },
      {
        label: "Fotos por produto",
        value: (p) =>
          p.entitlements.maxImagesPerProduct === 1 ? "1" : `Até ${p.entitlements.maxImagesPerProduct}`,
      },
      {
        label: "Lojas",
        value: (p) => (p.entitlements.maxStores === 1 ? "1" : `Até ${p.entitlements.maxStores}`),
      },
    ],
  },
  {
    title: "Operação",
    rows: [
      {
        label: "Usuários da equipe",
        value: (p) => (p.entitlements.maxTeamMembers === 1 ? "1" : `Até ${p.entitlements.maxTeamMembers}`),
      },
      { label: "Pedidos", value: () => "Ilimitados" },
      { label: "Clientes", value: () => "Ilimitados" },
      { label: "Controle de estoque", value: () => true },
    ],
  },
  {
    title: "Vendas",
    rows: [
      { label: "Checkout próprio", value: () => true },
      { label: "Pix via Mercado Pago", value: () => true },
      { label: "Cupons de desconto", value: (p) => p.entitlements.coupons },
    ],
  },
  {
    title: "Atendimento",
    rows: [
      { label: "Suporte", value: (p) => (p.entitlements.prioritySupport ? "Prioritário" : "Padrão") },
      { label: "Ajuda na configuração", value: (p) => p.entitlements.setupAssistance },
      { label: "Revisão inicial da loja", value: (p) => p.entitlements.storeReview },
      { label: "Acompanhamento na implantação", value: (p) => p.entitlements.implementationSupport },
    ],
  },
];

/** Sim/não nunca depende só de cor: vai ícone + texto para leitor de tela. */
function CellValue({ value }: { value: Cell }) {
  if (typeof value === "boolean") {
    return value ? (
      <span className={styles.yes}>
        <IconCheck aria-hidden="true" />
        <span className={styles.srOnly}>Incluído</span>
      </span>
    ) : (
      <span className={styles.no}>
        <IconClose aria-hidden="true" />
        <span className={styles.srOnly}>Não incluído</span>
      </span>
    );
  }
  return <span>{value}</span>;
}

export function PlanComparison() {
  return (
    <section className={styles.wrap} aria-labelledby="comparacao-planos">
      <h2 id="comparacao-planos" className={styles.title}>
        Compare os planos
      </h2>

      {/* ---------- desktop: tabela ---------- */}
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <caption className={styles.srOnly}>
            Comparação de recursos entre os planos Essencial, Crescimento e Profissional
          </caption>
          <thead>
            <tr>
              <th scope="col" className={styles.rowHead}>
                <span className={styles.srOnly}>Recurso</span>
              </th>
              {PLATFORM_PLANS.map((plan) => (
                <th key={plan.planKey} scope="col" className={styles.planHead} data-featured={plan.featured || undefined}>
                  <span className={styles.planName}>{plan.label}</span>
                  <span className={styles.planPrice}>{formatPlanPrice(plan)}/mês</span>
                </th>
              ))}
            </tr>
          </thead>
          {GROUPS.map((group) => (
            <tbody key={group.title}>
              <tr>
                <th scope="colgroup" colSpan={PLATFORM_PLANS.length + 1} className={styles.groupRow}>
                  {group.title}
                </th>
              </tr>
              {group.rows.map((row) => (
                <tr key={row.label}>
                  <th scope="row" className={styles.rowHead}>
                    {row.label}
                  </th>
                  {PLATFORM_PLANS.map((plan) => (
                    <td key={plan.planKey} className={styles.cell} data-featured={plan.featured || undefined}>
                      <CellValue value={row.value(plan)} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>

      {/* ---------- mobile: um bloco por plano ---------- */}
      <div className={styles.stack}>
        {PLATFORM_PLANS.map((plan) => (
          <article key={plan.planKey} className={styles.stackCard} data-featured={plan.featured || undefined}>
            <header className={styles.stackHead}>
              <h3 className={styles.stackName}>{plan.label}</h3>
              <span className={styles.stackPrice}>{formatPlanPrice(plan)}/mês</span>
            </header>

            {GROUPS.map((group) => (
              <div key={group.title} className={styles.stackGroup}>
                <h4 className={styles.stackGroupTitle}>{group.title}</h4>
                <dl className={styles.stackList}>
                  {group.rows.map((row) => (
                    <div key={row.label} className={styles.stackRow}>
                      <dt className={styles.stackLabel}>{row.label}</dt>
                      <dd className={styles.stackValue}>
                        <CellValue value={row.value(plan)} />
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </article>
        ))}
      </div>
    </section>
  );
}
