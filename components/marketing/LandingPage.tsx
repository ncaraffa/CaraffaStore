import Link from "next/link";
import { Logo, CaraffaMark } from "@/components/ui/Logo";
import { Button } from "@/components/ui/Button";
import { HeroScene } from "./HeroScene";
import {
  IconArrowRight,
  IconBox,
  IconCheck,
  IconLink,
  IconPix,
  IconReceipt,
  IconSearch,
  IconShield,
  IconTag,
} from "@/components/ui/icons";
import styles from "./LandingPage.module.css";

/* ============================================================
   Conteúdo
   Regra desta página: só afirma o que o produto faz hoje. Sem
   prova social, sem número de clientes, sem depoimento, sem
   "usado por" — nada disso existe ainda e nada disso é inventado.
   ============================================================ */

/** Cada plano tem `features: []` enquanto não existe diferenciação real no
 *  código. Quando ela existir, basta preencher — o card já renderiza a lista
 *  acima do CTA e o bloco "todos os planos incluem" continua valendo para o
 *  que for comum. */
const PLANS = [
  {
    code: 30,
    name: "Essencial",
    tier: 1,
    fit: "Para quem está montando a primeira loja online.",
    features: [] as string[],
    featured: false,
  },
  {
    code: 50,
    name: "Profissional",
    tier: 2,
    fit: "Para quem já vende e quer a operação organizada em um lugar só.",
    features: [] as string[],
    featured: true,
  },
  {
    code: 80,
    name: "Avançado",
    tier: 3,
    fit: "Para quem vende em volume e quer folga para crescer.",
    features: [] as string[],
    featured: false,
  },
];

/** Recursos reais, hoje comuns a todos os planos. */
const INCLUDED = [
  "Catálogo público com link próprio",
  "Produtos com fotos, preço e estoque",
  "Categorias para organizar a vitrine",
  "Carrinho e checkout sem cadastro do cliente",
  "Cobrança por Pix em cada pedido",
  "Painel de pedidos e baixa de estoque",
];

const STEPS = [
  {
    title: "Crie sua conta",
    body: "E-mail e senha, com confirmação por e-mail. Leva um minuto.",
  },
  {
    title: "Configure a loja",
    body: "Nome, endereço do link e o plano. A loja fica pronta para receber produtos.",
  },
  {
    title: "Monte o catálogo",
    body: "Categorias, fotos, preço e estoque. Você publica cada produto quando quiser.",
  },
  {
    title: "Conecte o Pix e venda",
    body: "Suas credenciais do Mercado Pago no painel, e cada pedido já nasce com QR Code.",
  },
];

const NOT_DOING = [
  {
    title: "Não fica com uma fatia da sua venda",
    body: "Você paga a mensalidade do plano e pronto. O valor do pedido é seu.",
  },
  {
    title: "Não obriga seu cliente a criar conta",
    body: "Ele escolhe, informa nome e telefone, e paga. Sem cadastro, sem senha, sem atrito.",
  },
  {
    title: "Não exige conhecimento técnico",
    body: "Nenhum código, nenhum servidor, nenhum plugin para instalar ou atualizar.",
  },
  {
    title: "Não mistura sua loja com outra",
    body: "O isolamento entre lojas é imposto no banco de dados, não só na tela.",
  },
];

const FAQS = [
  {
    q: "Como eu recebo o dinheiro das vendas?",
    a: "Por Pix, direto na sua conta do Mercado Pago. Você conecta suas próprias credenciais no painel e cada pedido gera um QR Code e um código copia e cola. A CaraffaStore nunca fica com o dinheiro no meio do caminho.",
  },
  {
    q: "A CaraffaStore cobra comissão sobre as vendas?",
    a: "Não. A cobrança é só a mensalidade do plano. As tarifas do Mercado Pago sobre cada Pix são do Mercado Pago e seguem as condições da sua conta lá.",
  },
  {
    q: "Preciso saber programar ou contratar alguém?",
    a: "Não. Você cria a conta, define o nome e o endereço da loja, cadastra os produtos e compartilha o link. Tudo pelo painel.",
  },
  {
    q: "Como o cliente compra na minha loja?",
    a: "Ele abre o link da loja, busca ou navega pelas categorias, adiciona ao carrinho e finaliza informando nome e telefone. Depois paga o Pix. Não precisa criar conta.",
  },
  {
    q: "O pagamento é confirmado sozinho?",
    a: "Sim. Quando o Pix é pago, a CaraffaStore recebe a confirmação do Mercado Pago e atualiza o pedido no seu painel. Há também uma reconciliação periódica para o caso de uma notificação se perder.",
  },
  {
    q: "E se eu precisar cancelar um pedido?",
    a: "Você cancela pelo painel, na tela do pedido. O estoque reservado volta para o catálogo.",
  },
  {
    q: "Meus dados e os do meu cliente estão seguros?",
    a: "Cada loja é isolada das demais por regras no próprio banco de dados, e suas credenciais de pagamento ficam criptografadas. O acesso à loja é sempre por conta autenticada.",
  },
  {
    q: "Posso trocar de plano depois?",
    a: "Pode. Hoje a troca é feita com o suporte; os três planos dão acesso aos mesmos recursos da plataforma.",
  },
];

const BENTO = [
  {
    key: "catalogo",
    icon: <IconLink />,
    title: "Um link, sua loja inteira",
    body: "Cada loja ganha um endereço próprio para mandar no WhatsApp, colocar na bio ou imprimir no cartão.",
  },
  {
    key: "pix",
    icon: <IconPix />,
    title: "Pix por pedido, na sua conta",
    body: "QR Code e copia e cola gerados automaticamente, com confirmação de pagamento sem você conferir extrato.",
  },
  {
    key: "produtos",
    icon: <IconBox />,
    title: "Produtos e estoque",
    body: "Fotos, preço, estoque e status de publicação. O estoque baixa sozinho a cada pedido pago.",
  },
  {
    key: "pedidos",
    icon: <IconReceipt />,
    title: "Pedidos em um lugar só",
    body: "Quem comprou, o que comprou, quanto pagou e em que ponto está.",
  },
  {
    key: "categorias",
    icon: <IconTag />,
    title: "Categorias",
    body: "Organize a vitrine do jeito que seu cliente procura.",
  },
  {
    key: "busca",
    icon: <IconSearch />,
    title: "Busca no catálogo",
    body: "Seu cliente digita o que quer e encontra, mesmo com o catálogo grande.",
  },
];

export function LandingPage() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link href="/" className={styles.headerLogo} aria-label="CaraffaStore, página inicial">
            <Logo size="md" compact />
          </Link>
          <nav className={styles.headerNav} aria-label="Seções desta página">
            <a href="#recursos">Recursos</a>
            <a href="#como-funciona">Como funciona</a>
            <a href="#planos">Planos</a>
            <a href="#faq">Dúvidas</a>
          </nav>
          <div className={styles.headerActions}>
            <Link href="/login" className={styles.headerLogin}>
              Entrar
            </Link>
            <Link href="/signup" className={styles.headerCta}>
              <Button size="sm">Criar minha loja</Button>
            </Link>
          </div>
        </div>
      </header>

      <main>
        {/* ---------------- Hero ---------------- */}
        <section className={styles.hero}>
          <div className={styles.heroGrid}>
            <div className={styles.heroText}>
              <p className={styles.eyebrow}>Loja virtual para pequenos comerciantes</p>
              <h1 className={styles.heroTitle}>
                Do catálogo ao <span className={styles.heroAccent}>Pix na sua conta</span>.
              </h1>
              <p className={styles.heroSubtitle}>
                Monte o catálogo, compartilhe o link da loja e receba por Pix direto na sua conta do Mercado Pago —
                sem comissão da CaraffaStore sobre o que você vende.
              </p>
              <div className={styles.heroActions}>
                <Link href="/signup">
                  <Button size="lg" icon={<IconArrowRight />}>
                    Criar minha loja
                  </Button>
                </Link>
                <a href="#como-funciona">
                  <Button size="lg" variant="outline">
                    Ver como funciona
                  </Button>
                </a>
              </div>

              {/* No lugar de prova social inventada: três fatos verificáveis. */}
              <ul className={styles.heroFacts}>
                <li>
                  <span className={styles.factKey}>Pix</span>
                  direto na sua conta
                </li>
                <li>
                  <span className={styles.factKey}>0%</span>
                  de comissão por venda
                </li>
                <li>
                  <span className={styles.factKey}>R$ 30</span>
                  por mês para começar
                </li>
              </ul>
            </div>

            <div className={styles.heroScene}>
              <HeroScene />
            </div>
          </div>
        </section>

        {/* ---------------- Recursos (bento) ---------------- */}
        <section id="recursos" className={styles.section}>
          <div className={styles.sectionHead}>
            <p className={styles.sectionLabel}>Recursos</p>
            <h2 className={styles.sectionTitle}>Tudo que a loja precisa para funcionar sozinha</h2>
            <p className={styles.sectionLead}>
              O que está listado aqui já está no ar. Nada é promessa de versão futura.
            </p>
          </div>

          <div className={styles.bento}>
            {BENTO.map((cell) => (
              <article key={cell.key} className={styles.bentoCell} data-cell={cell.key}>
                <span className={styles.bentoIcon}>{cell.icon}</span>
                <h3>{cell.title}</h3>
                <p>{cell.body}</p>

                {cell.key === "catalogo" && (
                  <div className={styles.urlChip} aria-hidden="true">
                    <IconLink />
                    <span>/loja/casa-do-cafe</span>
                  </div>
                )}

                {cell.key === "pix" && (
                  <div className={styles.pixProof} aria-hidden="true">
                    <span className={styles.pixProofDot} />
                    Pagamento confirmado · <span className={styles.mono}>#8F42A1</span>
                  </div>
                )}
              </article>
            ))}
          </div>
        </section>

        {/* ---------------- O que não fazemos ---------------- */}
        <section className={styles.bandSection}>
          <div className={styles.band}>
            <div className={styles.bandHead}>
              <p className={styles.sectionLabel}>Sem letra miúda</p>
              <h2 className={styles.sectionTitle}>O que a CaraffaStore não faz</h2>
              <p className={styles.sectionLead}>
                Quem vende pouco não pode ser surpreendido. Estas quatro coisas não acontecem aqui.
              </p>
            </div>
            <ul className={styles.bandList}>
              {NOT_DOING.map((item) => (
                <li key={item.title}>
                  <h3>{item.title}</h3>
                  <p>{item.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ---------------- Como funciona ---------------- */}
        <section id="como-funciona" className={styles.section}>
          <div className={styles.sectionHead}>
            <p className={styles.sectionLabel}>Como funciona</p>
            <h2 className={styles.sectionTitle}>Quatro passos até a primeira venda</h2>
          </div>

          <ol className={styles.steps}>
            {STEPS.map((step, index) => (
              <li key={step.title} className={styles.step}>
                <span className={styles.stepIndex}>{String(index + 1).padStart(2, "0")}</span>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* ---------------- Planos ---------------- */}
        <section id="planos" className={styles.sectionAlt}>
          <div className={styles.sectionHead}>
            <p className={styles.sectionLabel}>Planos</p>
            <h2 className={styles.sectionTitle}>Escolha o tamanho da sua operação</h2>
            <p className={styles.sectionLead}>
              Mensalidade fixa, sem comissão sobre vendas. Você escolhe o plano ao criar a loja.
            </p>
          </div>

          <div className={styles.plans}>
            {PLANS.map((plan) => (
              <article key={plan.code} className={styles.plan} data-featured={plan.featured || undefined}>
                {plan.featured && <span className={styles.planBadge}>Recomendado</span>}
                {/* Nível — o mesmo motivo do símbolo da marca. Ordena os planos
                    sem afirmar nenhum recurso que ainda não exista. */}
                <span className={styles.planLevel} aria-hidden="true">
                  <span data-on={plan.tier >= 1 || undefined} />
                  <span data-on={plan.tier >= 2 || undefined} />
                  <span data-on={plan.tier >= 3 || undefined} />
                </span>
                <h3 className={styles.planName}>{plan.name}</h3>
                <p className={styles.planPrice}>
                  <span className={styles.planCurrency}>R$</span>
                  {plan.code}
                  <span className={styles.planPeriod}>/mês</span>
                </p>
                <p className={styles.planFit}>{plan.fit}</p>

                {plan.features.length > 0 && (
                  <ul className={styles.planFeatures}>
                    {plan.features.map((feature) => (
                      <li key={feature}>
                        <IconCheck />
                        {feature}
                      </li>
                    ))}
                  </ul>
                )}

                <Link href="/signup" className={styles.planCta}>
                  <Button fullWidth size="lg" variant={plan.featured ? "primary" : "outline"}>
                    Começar com {plan.name}
                  </Button>
                </Link>
              </article>
            ))}
          </div>

          <div className={styles.included}>
            <p className={styles.includedTitle}>Todos os planos incluem</p>
            <ul className={styles.includedList}>
              {INCLUDED.map((item) => (
                <li key={item}>
                  <IconCheck />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ---------------- FAQ ---------------- */}
        <section id="faq" className={styles.section}>
          <div className={styles.sectionHead}>
            <p className={styles.sectionLabel}>Dúvidas</p>
            <h2 className={styles.sectionTitle}>Perguntas que todo lojista faz antes</h2>
          </div>

          <div className={styles.faq}>
            {FAQS.map((item) => (
              <details key={item.q} className={styles.faqItem} name="cs-faq">
                <summary>
                  <span>{item.q}</span>
                  <span className={styles.faqSign} aria-hidden="true" />
                </summary>
                <div className={styles.faqAnswer}>
                  <p>{item.a}</p>
                </div>
              </details>
            ))}
          </div>
        </section>

        {/* ---------------- CTA final ---------------- */}
        <section className={styles.finalCta}>
          <CaraffaMark className={styles.finalMark} />
          <div className={styles.finalInner}>
            <h2 className={styles.finalTitle}>Sua loja pode estar no ar hoje.</h2>
            <p className={styles.finalLead}>
              Crie a conta, cadastre os primeiros produtos e mande o link para os seus clientes.
            </p>
            <Link href="/signup">
              <Button size="lg" variant="outline" icon={<IconArrowRight />}>
                Criar minha loja
              </Button>
            </Link>
          </div>
        </section>
      </main>

      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <div className={styles.footerBrand}>
            <Logo size="md" />
            <p>Catálogo, pedidos e Pix para quem vende no bairro, no direct e no grupo da família.</p>
          </div>

          <nav className={styles.footerNav} aria-label="Rodapé">
            <div>
              <p className={styles.footerHeading}>Produto</p>
              <a href="#recursos">Recursos</a>
              <a href="#como-funciona">Como funciona</a>
              <a href="#planos">Planos</a>
            </div>
            <div>
              <p className={styles.footerHeading}>Conta</p>
              <Link href="/login">Entrar</Link>
              <Link href="/signup">Criar conta</Link>
            </div>
            <div>
              <p className={styles.footerHeading}>Legal</p>
              <Link href="/termos">Termos de Uso</Link>
              <Link href="/privacidade">Privacidade</Link>
            </div>
          </nav>
        </div>

        <div className={styles.footerBase}>
          <p>© {new Date().getFullYear()} CaraffaStore</p>
          <p className={styles.footerNote}>
            <IconShield />
            Pagamentos processados pelo Mercado Pago
          </p>
        </div>
      </footer>
    </div>
  );
}
