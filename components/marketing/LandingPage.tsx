import Link from "next/link";
import { Logo } from "@/components/ui/Logo";
import { Button } from "@/components/ui/Button";
import {
  IconBox,
  IconTag,
  IconReceipt,
  IconCreditCard,
  IconShield,
  IconPix,
  IconCheck,
  IconStore,
} from "@/components/ui/icons";
import styles from "./LandingPage.module.css";

const FEATURES = [
  {
    icon: <IconStore />,
    title: "Catálogo público",
    description: "Sua loja com URL própria, busca e categorias — pronta para compartilhar com clientes.",
  },
  {
    icon: <IconBox />,
    title: "Produtos e estoque",
    description: "Cadastre produtos com fotos, preço e estoque. Publique quando estiver pronto.",
  },
  {
    icon: <IconTag />,
    title: "Categorias",
    description: "Organize o catálogo para o cliente encontrar o que procura mais rápido.",
  },
  {
    icon: <IconReceipt />,
    title: "Carrinho e pedidos",
    description: "Checkout simples, sem exigir cadastro do cliente, com painel completo de pedidos.",
  },
  {
    icon: <IconPix />,
    title: "Pagamento via Pix",
    description: "Receba direto na sua conta Mercado Pago — QR Code e copia e cola automáticos por pedido.",
  },
  {
    icon: <IconShield />,
    title: "Dados isolados e seguros",
    description: "Cada loja é isolada das demais; credenciais de pagamento são sempre criptografadas.",
  },
];

const PLANS = [
  { price: 30, name: "Essencial", highlight: false },
  { price: 50, name: "Profissional", highlight: true },
  { price: 80, name: "Avançado", highlight: false },
];

const FAQS = [
  {
    q: "Preciso saber programar para usar?",
    a: "Não. Você cria sua loja em poucos passos: nome, endereço, produtos e já pode compartilhar o link com seus clientes.",
  },
  {
    q: "Como eu recebo os pagamentos?",
    a: "Via Pix, direto na sua própria conta Mercado Pago. Você conecta suas credenciais no painel — a CaraffaStore nunca retém o dinheiro das vendas.",
  },
  {
    q: "Posso mudar de plano depois?",
    a: "O plano escolhido no cadastro pode ser revisto com o suporte a qualquer momento.",
  },
  {
    q: "Meus dados ficam misturados com os de outras lojas?",
    a: "Não. O isolamento entre lojas é reforçado no banco de dados, não só na interface — uma loja nunca acessa dados de outra.",
  },
];

export function LandingPage() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Logo size="md" />
          <nav className={styles.headerNav}>
            <a href="#recursos">Recursos</a>
            <a href="#planos">Planos</a>
            <a href="#faq">Perguntas frequentes</a>
          </nav>
          <div className={styles.headerActions}>
            <Link href="/login" className={styles.headerLogin}>
              Entrar
            </Link>
            <Link href="/signup">
              <Button size="sm">Criar minha loja</Button>
            </Link>
          </div>
        </div>
      </header>

      <main>
        <section className={styles.hero}>
          <div className={styles.heroText}>
            <span className={styles.eyebrow}>Plataforma para pequenos comerciantes</span>
            <h1 className={styles.heroTitle}>
              Crie e administre sua loja virtual com a <span className={styles.heroBrand}>CaraffaStore</span>
            </h1>
            <p className={styles.heroSubtitle}>
              Catálogo, carrinho, pedidos e pagamentos via Pix — tudo em um painel simples, para você vender online
              sem complicação técnica.
            </p>
            <div className={styles.heroActions}>
              <Link href="/signup">
                <Button size="lg">Criar minha loja grátis</Button>
              </Link>
              <a href="#recursos">
                <Button size="lg" variant="outline">
                  Ver como funciona
                </Button>
              </a>
            </div>
          </div>

          <div className={styles.heroMock} aria-hidden="true">
            <div className={styles.mockWindow}>
              <div className={styles.mockTopbar}>
                <span />
                <span />
                <span />
              </div>
              <div className={styles.mockBody}>
                <div className={styles.mockSidebar}>
                  <div className={styles.mockLogo} />
                  <div className={styles.mockNavItem} data-active="true" />
                  <div className={styles.mockNavItem} />
                  <div className={styles.mockNavItem} />
                  <div className={styles.mockNavItem} />
                </div>
                <div className={styles.mockContent}>
                  <div className={styles.mockCardRow}>
                    <div className={styles.mockCard} />
                    <div className={styles.mockCard} />
                  </div>
                  <div className={styles.mockTableRow} />
                  <div className={styles.mockTableRow} />
                  <div className={styles.mockTableRow} />
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="recursos" className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2>Tudo que você precisa para vender online</h2>
            <p>Recursos já disponíveis na plataforma — sem surpresas.</p>
          </div>
          <div className={styles.featureGrid}>
            {FEATURES.map((feature) => (
              <div key={feature.title} className={styles.featureCard}>
                <span className={styles.featureIcon}>{feature.icon}</span>
                <h3>{feature.title}</h3>
                <p>{feature.description}</p>
              </div>
            ))}
          </div>
        </section>

        <section className={styles.sectionAlt}>
          <div className={styles.sectionHeader}>
            <h2>Como funciona</h2>
            <p>Do cadastro à primeira venda em minutos.</p>
          </div>
          <ol className={styles.steps}>
            <li>
              <span className={styles.stepNumber}>1</span>
              <div>
                <h3>Crie sua conta</h3>
                <p>Cadastro com e-mail e senha, confirmação rápida por e-mail.</p>
              </div>
            </li>
            <li>
              <span className={styles.stepNumber}>2</span>
              <div>
                <h3>Configure sua loja</h3>
                <p>Nome, endereço da loja e escolha do plano.</p>
              </div>
            </li>
            <li>
              <span className={styles.stepNumber}>3</span>
              <div>
                <h3>Cadastre produtos</h3>
                <p>Categorias, fotos, preço e estoque — publique quando quiser.</p>
              </div>
            </li>
            <li>
              <span className={styles.stepNumber}>4</span>
              <div>
                <h3>Venda com Pix</h3>
                <p>Conecte o Mercado Pago e receba pedidos com pagamento automático.</p>
              </div>
            </li>
          </ol>
        </section>

        <section id="planos" className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2>Planos simples e diretos</h2>
            <p>Escolha um plano ao criar sua loja. Sem taxa sobre suas vendas.</p>
          </div>
          <div className={styles.plansGrid}>
            {PLANS.map((plan) => (
              <div key={plan.price} className={styles.planCard} data-highlight={plan.highlight || undefined}>
                {plan.highlight && <span className={styles.planBadge}>Mais escolhido</span>}
                <h3>{plan.name}</h3>
                <p className={styles.planPrice}>
                  R$ {plan.price}
                  <span>/mês</span>
                </p>
                <ul className={styles.planList}>
                  <li>
                    <IconCheck /> Catálogo e produtos ilimitados
                  </li>
                  <li>
                    <IconCheck /> Carrinho e checkout com Pix
                  </li>
                  <li>
                    <IconCheck /> Painel de pedidos completo
                  </li>
                </ul>
                <Link href="/signup">
                  <Button fullWidth variant={plan.highlight ? "primary" : "outline"}>
                    Começar
                  </Button>
                </Link>
              </div>
            ))}
          </div>
        </section>

        <section className={styles.sectionAlt}>
          <div className={styles.securityGrid}>
            <div>
              <span className={styles.featureIcon}>
                <IconShield />
              </span>
              <h2>Segurança em primeiro lugar</h2>
              <p>
                Isolamento total entre lojas reforçado no banco de dados, credenciais de pagamento sempre
                criptografadas e comunicação via HTTPS. Sua loja e seus clientes protegidos desde o primeiro dia.
              </p>
            </div>
            <div>
              <span className={styles.featureIcon}>
                <IconCreditCard />
              </span>
              <h2>Pix direto na sua conta</h2>
              <p>
                A CaraffaStore nunca retém o dinheiro das suas vendas — o Pix cai direto na sua própria conta Mercado
                Pago, com confirmação automática de pagamento.
              </p>
            </div>
          </div>
        </section>

        <section id="faq" className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2>Perguntas frequentes</h2>
          </div>
          <div className={styles.faqList}>
            {FAQS.map((item) => (
              <details key={item.q} className={styles.faqItem}>
                <summary>{item.q}</summary>
                <p>{item.a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className={styles.ctaSection}>
          <h2>Pronto para vender online?</h2>
          <p>Crie sua loja agora — leva menos de 5 minutos.</p>
          <Link href="/signup">
            <Button size="lg">Criar minha loja grátis</Button>
          </Link>
        </section>
      </main>

      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <Logo size="sm" />
          <nav className={styles.footerLinks}>
            <Link href="/termos">Termos de Uso</Link>
            <Link href="/privacidade">Política de Privacidade</Link>
            <Link href="/login">Entrar</Link>
            <Link href="/signup">Criar conta</Link>
          </nav>
          <p className={styles.footerCopy}>© {new Date().getFullYear()} CaraffaStore. Todos os direitos reservados.</p>
        </div>
      </footer>
    </div>
  );
}
