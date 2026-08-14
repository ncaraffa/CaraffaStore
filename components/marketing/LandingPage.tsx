import Link from "next/link";
import { Logo, CaraffaMark } from "@/components/ui/Logo";
import { Button } from "@/components/ui/Button";
import { HeroScene } from "./HeroScene";
import { StoreScene } from "./StoreScene";
import { ConversationScene } from "./ConversationScene";
import { StorefrontDemo } from "./StorefrontDemo";
import { PlanPicker } from "./PlanPicker";
import { RevealRoot } from "./RevealRoot";
import { getStoreUrlExample } from "@/lib/config/site";
import {
  IconArrowRight,
  IconBox,
  IconCheck,
  IconLink,
  IconPix,
  IconReceipt,
  IconShield,
} from "@/components/ui/icons";
import styles from "./LandingPage.module.css";

/* ============================================================
   Conteúdo

   Regra desta página: só afirma o que o produto faz hoje. Sem prova
   social, sem número de clientes, sem depoimento, sem "usado por" —
   nada disso existe ainda e nada disso é inventado.

   Segunda regra, da V2: cada vantagem é dita UMA vez, no lugar onde
   ela pesa mais. "Sem comissão", "Pix", "estoque" e "link no
   WhatsApp" apareciam quatro e cinco vezes cada; a repetição não
   convencia mais ninguém depois da segunda — ocupava o espaço que a
   demonstração da loja merecia.

   Terceira regra: quem lê é comerciante, não programador. Nenhuma
   frase aqui explica arquitetura. Se o argumento só faz sentido para
   quem conhece o banco de dados, ele não é um argumento de venda.

   Ritmo: impacto → a loja do cliente (a prova) → recursos → o que
   não fazemos → QUEBRA AZUL → como funciona → planos → dúvidas →
   fechamento.
   ============================================================ */

const BENTO = [
  {
    key: "catalogo",
    icon: <IconLink />,
    title: "Um link, sua loja inteira",
    body: "Endereço próprio para mandar no WhatsApp ou pôr na bio, com categorias e busca para o cliente achar o que quer.",
  },
  {
    key: "pix",
    icon: <IconPix />,
    title: "Pix por pedido, na sua conta",
    body: "QR Code e copia e cola gerados no ato. O pedido é confirmado sem você conferir extrato.",
  },
  {
    key: "produtos",
    icon: <IconBox />,
    title: "Produtos e estoque",
    body: "Fotos, preço e publicação sob seu controle. O estoque baixa sozinho a cada pedido pago.",
  },
  {
    key: "pedidos",
    icon: <IconReceipt />,
    title: "Pedidos em um lugar só",
    body: "Quem comprou, o quê, quanto pagou e em que ponto está.",
  },
];

const NOT_DOING = [
  {
    title: "Não fica com uma fatia da sua venda",
    body: "Você paga a mensalidade e pronto. O valor do pedido cai inteiro na sua conta.",
  },
  {
    title: "Não obriga seu cliente a criar conta",
    body: "Ele escolhe, informa os dados do pedido e paga. Sem senha, sem app para baixar.",
  },
  {
    title: "Não mistura sua loja com outra",
    body: "Seus produtos, pedidos e clientes ficam separados de qualquer outra loja da plataforma.",
  },
];

const STEPS = [
  {
    title: "Crie sua conta",
    body: "E-mail, senha e confirmação por e-mail. Leva um minuto.",
  },
  {
    title: "Configure a loja",
    body: "Nome, endereço do link e plano. A loja abre assim que a primeira mensalidade for paga.",
  },
  {
    title: "Monte o catálogo",
    body: "Categorias, fotos, preço e estoque. Você publica cada produto quando quiser.",
  },
  {
    title: "Conecte o Mercado Pago",
    body: "Uma vez só, no painel. Daí em diante todo pedido já nasce com o Pix pronto.",
  },
];

const FAQS = [
  {
    q: "Como eu recebo o dinheiro das vendas?",
    a: "Direto na sua conta do Mercado Pago, por Pix. A CaraffaStore nunca fica com o dinheiro no caminho e não cobra comissão — as tarifas de cada Pix são do Mercado Pago, nas condições da sua conta lá.",
  },
  {
    q: "O que preciso fazer para conectar o Mercado Pago?",
    a: "Gerar uma chave de integração na sua conta, colar no painel e cadastrar lá um endereço que mostramos pronto. Três passos, com as instruções na tela. Não precisa programar, mas parte deles acontece no site do Mercado Pago.",
  },
  {
    q: "Quando minha loja fica no ar?",
    a: "Você paga a primeira mensalidade por Pix na própria plataforma e, assim que ela é aprovada, a loja é ativada e o painel liberado. Não guardamos cartão nem fazemos débito automático.",
  },
  {
    q: "Como o cliente compra na minha loja?",
    a: "Abre o link, escolhe os produtos e informa nome, telefone e os dados que o Pix exige (e-mail e CPF ou CNPJ). Depois escolhe entre retirada e entrega e paga. Sem criar conta.",
  },
  {
    q: "O pagamento é confirmado sozinho?",
    a: "Sim: o Mercado Pago avisa a loja, o pedido muda de status e o estoque baixa. Uma conferência periódica cobre o caso raro de um aviso se perder.",
  },
  {
    q: "E se eu precisar cancelar um pedido?",
    a: "Cancela pelo painel, na tela do pedido. O estoque reservado volta para o catálogo na hora.",
  },
];

export function LandingPage() {
  const storeUrlExample = getStoreUrlExample();

  return (
    <div className={styles.page}>
      <RevealRoot />

      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link href="/" className={styles.headerLogo} aria-label="CaraffaStore, página inicial">
            <Logo size="md" compact />
          </Link>
          <nav className={styles.headerNav} aria-label="Seções desta página">
            <a href="#loja-demo">Ver a loja</a>
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
              <Button as="span" size="sm">Criar minha loja</Button>
            </Link>
          </div>
        </div>
      </header>

      <main>
        {/* ===================== 1. IMPACTO ===================== */}
        <section className={styles.hero}>
          <div className={styles.heroGrid}>
            <div className={styles.heroText}>
              <p className={styles.eyebrow} data-reveal style={{ "--reveal-delay": "0ms" } as React.CSSProperties}>
                Loja virtual para pequenos comerciantes
              </p>
              <h1 className={styles.heroTitle} data-reveal style={{ "--reveal-delay": "70ms" } as React.CSSProperties}>
                Do catálogo ao <span className={styles.heroAccent}>Pix na sua conta</span>.
              </h1>
              <p
                className={styles.heroSubtitle}
                data-reveal
                style={{ "--reveal-delay": "150ms" } as React.CSSProperties}
              >
                Monte o catálogo, mande o link para os seus clientes e receba por Pix direto na sua conta do Mercado
                Pago. Sem comissão sobre o que você vende.
              </p>
              <div
                className={styles.heroActions}
                data-reveal
                style={{ "--reveal-delay": "220ms" } as React.CSSProperties}
              >
                <Link href="/signup">
                  <Button as="span" size="lg" icon={<IconArrowRight />} iconPosition="end">
                    Criar minha loja
                  </Button>
                </Link>
                <a href="#loja-demo">
                  <Button as="span" size="lg" variant="outline">
                    Ver uma loja de demonstração
                  </Button>
                </a>
              </div>

              {/* No lugar de prova social inventada: três fatos verificáveis.
                  O texto de cada fato vive no próprio <span>, não solto no
                  <li>: solto, o JSX come o espaço entre o número e a palavra
                  e a linha vira "0%de comissão" ao ser copiada ou lida por
                  leitor de tela, mesmo parecendo certa na tela. */}
              <ul className={styles.heroFacts} data-reveal style={{ "--reveal-delay": "290ms" } as React.CSSProperties}>
                <li>
                  <span className={styles.factKey}>Pix</span>
                  <span className={styles.factText}>direto na sua conta</span>
                </li>
                <li>
                  <span className={styles.factKey}>0%</span>
                  <span className={styles.factText}>de comissão por venda</span>
                </li>
                <li>
                  <span className={styles.factKey}>R$ 30</span>
                  <span className={styles.factText}>por mês para começar</span>
                </li>
              </ul>
            </div>

            <div className={styles.heroScene} data-reveal="lift" style={{ "--reveal-delay": "180ms" } as React.CSSProperties}>
              <HeroScene />
            </div>
          </div>
        </section>

        {/* ============ 2. A LOJA DO CLIENTE — a prova ============ */}
        <section id="loja-demo" className={styles.sectionAlt}>
          <div className={styles.sectionHead} data-reveal>
            <p className={styles.sectionLabel}>Demonstração</p>
            <h2 className={styles.sectionTitle}>Como a sua loja fica para quem compra</h2>
            <p className={styles.sectionLead}>
              As telas que a CaraffaStore monta sozinha a partir dos seus produtos. A loja é fictícia; a interface é
              a real.
            </p>
            <p className={styles.demoUrl}>
              <IconLink />
              <span className={styles.mono}>{storeUrlExample}</span>
            </p>
          </div>

          <StorefrontDemo />
        </section>

        {/* ===================== 3. RECURSOS ===================== */}
        <section id="recursos" className={styles.section}>
          <div className={styles.sectionHead} data-reveal>
            <p className={styles.sectionLabel}>Recursos</p>
            <h2 className={styles.sectionTitle}>Tudo que a loja precisa para vender</h2>
            <p className={styles.sectionLead}>
              O que está listado aqui já está no ar. Nada é promessa de versão futura.
            </p>
          </div>

          <div className={styles.bento}>
            {BENTO.map((cell, index) => (
              <article
                key={cell.key}
                className={styles.bentoCell}
                data-cell={cell.key}
                data-reveal
                style={{ "--reveal-delay": `${index * 55}ms` } as React.CSSProperties}
              >
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

        {/* ===================== 4. SEM LETRA MIÚDA ===================== */}
        <section className={styles.bandSection}>
          <div className={styles.band}>
            <div className={styles.bandHead} data-reveal="left">
              <p className={styles.sectionLabel}>Sem letra miúda</p>
              <h2 className={styles.sectionTitle}>O que a CaraffaStore não faz</h2>
              <p className={styles.sectionLead}>
                Quem vende pouco não pode ser surpreendido. Estas três coisas não acontecem aqui.
              </p>
            </div>
            <ul className={styles.bandList}>
              {NOT_DOING.map((item, index) => (
                <li key={item.title} data-reveal style={{ "--reveal-delay": `${index * 70}ms` } as React.CSSProperties}>
                  <h3>{item.title}</h3>
                  <p>{item.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ============ 5. A QUEBRA — o momento da página ============ */}
        <section className={styles.blueMoment}>
          <div className={styles.blueGrid}>
            <div className={styles.blueText}>
              <p className={styles.blueLabel} data-reveal="left">
                Comece hoje
              </p>
              <h2
                className={styles.blueTitle}
                data-reveal="left"
                style={{ "--reveal-delay": "70ms" } as React.CSSProperties}
              >
                Sua loja pode estar no ar <span className={styles.blueAccent}>hoje</span>.
              </h2>
              <p
                className={styles.blueLead}
                data-reveal="left"
                style={{ "--reveal-delay": "140ms" } as React.CSSProperties}
              >
                Crie a conta, cadastre os primeiros produtos e mande o link. Do outro lado, seu cliente escolhe, paga
                e o pedido aparece no seu painel.
              </p>

              <ul
                className={styles.blueChecks}
                data-reveal="left"
                style={{ "--reveal-delay": "210ms" } as React.CSSProperties}
              >
                <li>
                  <IconCheck /> Sem instalar nem manter nada
                </li>
                <li>
                  <IconCheck /> Sem cartão de crédito: a mensalidade é por Pix
                </li>
                <li>
                  <IconCheck /> Sem fidelidade nem multa para sair
                </li>
              </ul>

              <div
                className={styles.blueActions}
                data-reveal="left"
                style={{ "--reveal-delay": "280ms" } as React.CSSProperties}
              >
                <Link href="/signup">
                  <Button as="span" size="lg" icon={<IconArrowRight />} iconPosition="end">
                    Criar minha loja
                  </Button>
                </Link>
                <a href="#planos" className={styles.blueLink}>
                  Ver planos
                </a>
              </div>
            </div>

            <div className={styles.blueScene} data-reveal="lift" style={{ "--reveal-delay": "120ms" } as React.CSSProperties}>
              <StoreScene />
            </div>
          </div>
        </section>

        {/* ============ 6. COMO FUNCIONA ============ */}
        <section id="como-funciona" className={styles.section}>
          <div className={styles.sectionHead} data-reveal>
            <p className={styles.sectionLabel}>Como funciona</p>
            <h2 className={styles.sectionTitle}>Da conta criada ao primeiro pedido pago</h2>
            <p className={styles.sectionLead}>
              Quatro passos no painel — e a venda acontecendo onde ela já acontece hoje: na conversa com o cliente.
            </p>
          </div>

          <div className={styles.flowGrid}>
            <ol className={styles.steps}>
              {STEPS.map((step, index) => (
                <li
                  key={step.title}
                  className={styles.step}
                  data-reveal="left"
                  style={{ "--reveal-delay": `${index * 80}ms` } as React.CSSProperties}
                >
                  <span className={styles.stepIndex}>{String(index + 1).padStart(2, "0")}</span>
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                </li>
              ))}
            </ol>

            <div className={styles.flowHuman} data-reveal="right" style={{ "--reveal-delay": "120ms" } as React.CSSProperties}>
              <ConversationScene />
            </div>
          </div>
        </section>

        {/* ===================== 7. PLANOS ===================== */}
        <section id="planos" className={styles.sectionAlt}>
          <div className={styles.sectionHead} data-reveal>
            <p className={styles.sectionLabel}>Planos</p>
            <h2 className={styles.sectionTitle}>Um produto completo, três faixas de preço</h2>
            <p className={styles.sectionLead}>
              A plataforma inteira em qualquer faixa, sem limite de produtos, fotos ou pedidos. Você escolhe a faixa
              que corresponde ao tamanho da sua operação.
            </p>
          </div>

          <div className={styles.planPanel} data-reveal="lift">
            <PlanPicker />
          </div>

          <p className={styles.planHonesty} data-reveal>
            <IconShield />
            <span>
              <strong>Por que três preços se os recursos são os mesmos?</strong> Porque preferimos dizer isso a
              inventar limitação no plano mais barato para empurrar o mais caro. Se um dia uma faixa ganhar recurso
              exclusivo, ele estará escrito aqui — depois de existir, nunca antes.
            </span>
          </p>
        </section>

        {/* ===================== 8. DÚVIDAS ===================== */}
        <section id="faq" className={styles.section}>
          <div className={styles.sectionHead} data-reveal>
            <p className={styles.sectionLabel}>Dúvidas</p>
            <h2 className={styles.sectionTitle}>Perguntas que todo lojista faz antes</h2>
          </div>

          <div className={styles.faq}>
            {FAQS.map((item, index) => (
              <details
                key={item.q}
                className={styles.faqItem}
                name="cs-faq"
                data-reveal
                style={{ "--reveal-delay": `${Math.min(index, 4) * 45}ms` } as React.CSSProperties}
              >
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

          <p className={styles.faqFooter} data-reveal>
            As condições completas estão nos <Link href="/termos">Termos de Uso</Link> e na{" "}
            <Link href="/privacidade">Política de Privacidade</Link>, em português claro.
          </p>
        </section>
      </main>

      {/* ===================== 9. FECHAMENTO ===================== */}
      <footer className={styles.footer}>
        <div className={styles.closer} data-reveal>
          <CaraffaMark className={styles.closerMark} />
          <div className={styles.closerText}>
            <h2>Pronto para receber o primeiro pedido?</h2>
            <p>Leva menos tempo do que montar uma vitrine.</p>
          </div>
          <Link href="/signup" className={styles.closerCta}>
            <Button as="span" size="lg" icon={<IconArrowRight />} iconPosition="end">
              Criar minha loja
            </Button>
          </Link>
        </div>

        <div className={styles.footerInner}>
          <div className={styles.footerBrand}>
            <Logo size="md" />
            <p>Catálogo, pedidos e Pix para quem vende no bairro, no direct e no grupo da família.</p>
          </div>

          <nav className={styles.footerNav} aria-label="Rodapé">
            <div>
              <p className={styles.footerHeading}>Produto</p>
              <a href="#loja-demo">Ver a loja</a>
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
