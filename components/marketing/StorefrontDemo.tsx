import { getStoreUrlExample } from "@/lib/config/site";
import { IconCheck, IconCopy, IconPix, IconSearch, IconShoppingCart } from "@/components/ui/icons";
import styles from "./StorefrontDemo.module.css";

/* ============================================================
   A loja do cliente, reproduzida fielmente

   Isto NÃO é uma ilustração livre: é a mesma interface que a
   CaraffaStore gera hoje em /loja/[slug], remontada em escala menor
   com os mesmos tokens, a mesma hierarquia e os mesmos textos de
   sistema — rótulo "CATÁLOGO" em mono, nome da loja em peso 800,
   contagem real de produtos/categorias, chips de categoria com o
   ativo em navy, card 1:1 com preço em tabular, botão de quantidade
   ao lado de "Adicionar", tela de Pix com QR + copia e cola +
   contagem de expiração.

   O que a plataforma NÃO faz também é respeitado: a loja pública não
   tem logo nem capa personalizável hoje, então nada disso aparece
   aqui. Mostrar uma capa bonita que o produto não entrega seria
   propaganda enganosa.

   As "fotos" dos produtos são vetores desenhados aqui mesmo: nenhuma
   imagem para baixar no celular e nenhuma foto de banco de imagens
   fingindo ser uma loja real.
   ============================================================ */

type ArtKind = "bag" | "grinder" | "dripper" | "mug";

const PRODUCTS: { name: string; price: string; art: ArtKind; soldOut?: boolean }[] = [
  { name: "Café em grãos · Cerrado 500 g", price: "R$ 42,00", art: "bag" },
  { name: "Coador de pano com suporte", price: "R$ 24,50", art: "dripper" },
  { name: "Caneca de cerâmica 300 ml", price: "R$ 38,00", art: "mug" },
  { name: "Moedor manual em inox", price: "R$ 129,90", art: "grinder", soldOut: true },
];

/**
 * "Fotos" dos produtos, desenhadas aqui mesmo.
 *
 * Nenhuma imagem é baixada — nem foto de banco de imagens fingindo ser
 * uma loja real, nem asset externo. São vetores originais, com fundo
 * quente próprio por produto, sombra de contato e volume em degradê:
 * o suficiente para a vitrine parecer uma loja que alguém teria, sem
 * fingir fotografia.
 *
 * Cada `kind` traz o próprio par de cores de fundo, então quatro cards
 * lado a lado não viram quatro retângulos bege iguais.
 */
const ART_BACKGROUND: Record<ArtKind, [string, string]> = {
  bag: ["#f6efe6", "#e9dccb"],
  dripper: ["#f2f0ea", "#e2ded2"],
  mug: ["#eef2fa", "#dde5f4"],
  grinder: ["#f1f0ee", "#dfdedb"],
};

function ProductArt({ kind }: { kind: ArtKind }) {
  const [from, to] = ART_BACKGROUND[kind];
  // Sufixo por produto: os quatro SVGs convivem na mesma página e ids
  // repetidos fariam um herdar o degradê do outro.
  const gid = `cs-art-${kind}`;

  return (
    <svg viewBox="0 0 120 120" className={styles.art} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${gid}-bg`} x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0" stopColor={from} />
          <stop offset="1" stopColor={to} />
        </linearGradient>
        <linearGradient id={`${gid}-body`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.28" />
          <stop offset="0.45" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="1" stopColor="#000000" stopOpacity="0.14" />
        </linearGradient>
      </defs>

      <rect width="120" height="120" fill={`url(#${gid}-bg)`} />
      {/* Sombra de contato: assenta o objeto na superfície. */}
      <ellipse cx="60" cy="99" rx="30" ry="5.5" fill="#4a3a2a" opacity="0.14" />

      {kind === "bag" && (
        <g>
          {/* Fole lateral, corpo e topo dobrado com selo. */}
          <path d="M41 36h38l4.5 52a9 9 0 0 1-9 9.8H45.5a9 9 0 0 1-9-9.8L41 36Z" fill="#4b3524" />
          <path d="M41 36h38l4.5 52a9 9 0 0 1-9 9.8H60V36Z" fill="#3d2b1d" />
          <path d="M41 36h38l4.5 52a9 9 0 0 1-9 9.8H45.5a9 9 0 0 1-9-9.8L41 36Z" fill={`url(#${gid}-body)`} />
          <path d="M45 25h30a3 3 0 0 1 3 3v8H42v-8a3 3 0 0 1 3-3Z" fill="#5d432e" />
          <rect x="52" y="21" width="16" height="6" rx="3" fill="#8c6b4a" />
          {/* Etiqueta de papel com a linha de nível da marca. */}
          <rect x="47" y="52" width="26" height="30" rx="3" fill="#f4ece0" />
          <rect x="51" y="58" width="18" height="3" rx="1.5" fill="#4b3524" />
          <rect x="51" y="65" width="12" height="2.5" rx="1.25" fill="#8c6b4a" />
          <rect x="51" y="73" width="18" height="3" rx="1.5" fill="#d9c4a6" />
          <rect x="51" y="73" width="11" height="3" rx="1.5" fill="#1b4dff" opacity="0.75" />
        </g>
      )}

      {kind === "dripper" && (
        <g>
          {/* Jarra de vidro embaixo, suporte de madeira e coador de pano. */}
          <path d="M42 70h36v14a12 12 0 0 1-12 12H54a12 12 0 0 1-12-12V70Z" fill="#dfe6f0" opacity="0.85" />
          <path d="M42 78h36v6a12 12 0 0 1-12 12H54a12 12 0 0 1-12-12v-6Z" fill="#6b4a2f" opacity="0.55" />
          <rect x="40" y="66" width="40" height="5" rx="2.5" fill="#8c6b4a" />
          <path d="M36 40h48l-9 22a4 4 0 0 1-3.6 2.3H48.6A4 4 0 0 1 45 62L36 40Z" fill="#f7f3ea" />
          <path d="M36 40h48l-9 22a4 4 0 0 1-3.6 2.3H60V40Z" fill="#e7e0d2" />
          <path d="M36 40h48l-2.2 5.4H38.2L36 40Z" fill="#c9bda9" />
          <path d="M36 40h48l-9 22a4 4 0 0 1-3.6 2.3H48.6A4 4 0 0 1 45 62L36 40Z" fill={`url(#${gid}-body)`} />
          {/* Fio de café caindo. */}
          <rect x="58.5" y="64" width="3" height="9" rx="1.5" fill="#6b4a2f" opacity="0.6" />
        </g>
      )}

      {kind === "mug" && (
        <g>
          {/* Vapor — três traços leves, o único movimento da composição. */}
          <path d="M50 28c3-4-3-7 0-11M60 26c3-4-3-7 0-11M70 28c3-4-3-7 0-11" stroke="#98a6bd" strokeWidth="2.4" strokeLinecap="round" fill="none" opacity="0.55" />
          <path d="M76 56h7a11 11 0 0 1 0 22h-7" fill="none" stroke="#e3e9f4" strokeWidth="9" strokeLinecap="round" />
          <path d="M76 56h7a11 11 0 0 1 0 22h-7" fill="none" stroke="#c5d1e6" strokeWidth="3" strokeLinecap="round" />
          <path d="M36 44h42v33a17 17 0 0 1-17 17H53a17 17 0 0 1-17-17V44Z" fill="#ffffff" />
          <path d="M36 44h42v9H36z" fill="#1b4dff" opacity="0.82" />
          <path d="M36 44h42v33a17 17 0 0 1-17 17H53a17 17 0 0 1-17-17V44Z" fill={`url(#${gid}-body)`} />
          <ellipse cx="57" cy="44" rx="21" ry="4.4" fill="#f0f4fc" />
          <ellipse cx="57" cy="44" rx="16" ry="3" fill="#3a2a1c" opacity="0.75" />
        </g>
      )}

      {kind === "grinder" && (
        <g>
          {/* Manivela, corpo em inox e coletor de madeira. */}
          <path d="M60 20v9" stroke="#8a9099" strokeWidth="3.4" strokeLinecap="round" />
          <path d="M60 22h16a4 4 0 0 1 4 4v3" stroke="#8a9099" strokeWidth="3.4" strokeLinecap="round" fill="none" />
          <rect x="75" y="28" width="10" height="7" rx="3.5" fill="#6b4a2f" />
          <path d="M46 34h28a4 4 0 0 1 4 4v6H42v-6a4 4 0 0 1 4-4Z" fill="#aeb5bf" />
          <rect x="42" y="44" width="36" height="26" rx="4" fill="#c3c9d2" />
          <rect x="42" y="44" width="36" height="26" rx="4" fill={`url(#${gid}-body)`} />
          <rect x="45" y="53" width="30" height="3" rx="1.5" fill="#8a9099" opacity="0.5" />
          <path d="M44 72h32a4 4 0 0 1 4 4v14a6 6 0 0 1-6 6H46a6 6 0 0 1-6-6V76a4 4 0 0 1 4-4Z" fill="#7a5637" />
          <path d="M44 72h32a4 4 0 0 1 4 4v14a6 6 0 0 1-6 6H60V72Z" fill="#66462c" />
          <rect x="52" y="80" width="16" height="3.4" rx="1.7" fill="#e6d6c0" opacity="0.55" />
        </g>
      )}
    </svg>
  );
}

/** Tela 1 — catálogo, exatamente como a loja pública monta hoje. */
function CatalogScreen() {
  return (
    <div className={styles.screen}>
      <div className={styles.storeHeader}>
        <span className={styles.storeName}>Casa do Café</span>
        <span className={styles.cartBadge}>
          <IconShoppingCart />
          <span className={styles.cartCount}>2</span>
        </span>
      </div>

      <div className={styles.screenBody}>
        <div className={styles.intro}>
          <p className={styles.introLabel}>Catálogo</p>
          <p className={styles.introTitle}>Casa do Café</p>
          <p className={styles.introMeta}>4 produtos em 3 categorias</p>
        </div>

        <div className={styles.searchRow}>
          <span className={styles.searchField}>
            <IconSearch />
            Buscar produtos...
          </span>
        </div>

        <div className={styles.chips}>
          <span className={styles.chip} data-active="true">
            Todas
          </span>
          <span className={styles.chip}>Grãos</span>
          <span className={styles.chip}>Acessórios</span>
          <span className={styles.chip}>Presentes</span>
        </div>

        <div className={styles.grid}>
          {PRODUCTS.map((product) => (
            <div key={product.name} className={styles.card}>
              <div className={styles.cardImage}>
                <ProductArt kind={product.art} />
                {product.soldOut && <span className={styles.soldOut}>Esgotado</span>}
              </div>
              <p className={styles.cardTitle}>{product.name}</p>
              <p className={styles.cardPrice}>{product.price}</p>
              {product.soldOut ? (
                <span className={styles.cardSoldOutAction}>Esgotado</span>
              ) : (
                <span className={styles.cardAction}>
                  <span className={styles.qty}>1</span>
                  <span className={styles.addButton}>Adicionar</span>
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Tela 2 — finalização do pedido, com os campos que o checkout pede de verdade. */
function CheckoutScreen() {
  return (
    <div className={styles.screen}>
      <div className={styles.storeHeader}>
        <span className={styles.backLink}>← Carrinho</span>
        <span className={styles.cartBadge}>
          <IconShoppingCart />
          <span className={styles.cartCount}>2</span>
        </span>
      </div>

      <div className={styles.screenBody}>
        <p className={styles.pageTitle}>Finalizar pedido</p>

        <div className={styles.summaryBar}>
          <span className={styles.summaryCount}>2 itens</span>
          <span className={styles.summaryTotal}>R$ 66,50</span>
        </div>

        <p className={styles.formLabel}>Seus dados</p>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Nome</span>
          <span className={styles.fieldBox}>Marina Alves</span>
        </div>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Telefone / WhatsApp</span>
          <span className={styles.fieldBox}>(11) 99999-8888</span>
        </div>

        <p className={styles.formLabel}>Entrega</p>
        <div className={styles.fulfillment}>
          <span className={styles.fulfillmentOption} data-active="true">
            Retirada
          </span>
          <span className={styles.fulfillmentOption}>Entrega</span>
        </div>

        <span className={styles.primaryButton}>Enviar pedido</span>
        <p className={styles.trustLine}>Pagamento processado com segurança pelo Mercado Pago</p>
      </div>
    </div>
  );
}

/** Tela 3 — o Pix do pedido, com QR, copia e cola e expiração. */
function PaymentScreen() {
  return (
    <div className={styles.screen}>
      <div className={styles.storeHeader}>
        <span className={styles.storeName}>Casa do Café</span>
      </div>

      <div className={styles.screenBody}>
        <div className={styles.payCard}>
          <div className={styles.payStatus}>
            <IconPix />
            Aguardando pagamento
          </div>

          <div className={styles.payAmountBlock}>
            <span className={styles.payAmountLabel}>Valor do pedido</span>
            <span className={styles.payAmount}>R$ 66,50</span>
            <span className={styles.payCode}>Pedido #8F42A1</span>
          </div>

          <div className={styles.qrFrame}>
            <QrArt />
          </div>

          <p className={styles.expires}>
            Expira em <strong>14:52</strong>
          </p>

          <p className={styles.copyLabel}>Pix Copia e Cola</p>
          <span className={styles.copyField}>00020126580014br.gov.bcb.pix…</span>
          <span className={styles.primaryButton}>
            <IconCopy />
            Copiar código
          </span>
        </div>

        <div className={styles.confirmedToast}>
          <span className={styles.confirmedIcon}>
            <IconCheck />
          </span>
          <span>
            <strong>Pagamento confirmado</strong>
            <br />O pedido já aparece no painel do lojista.
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * QR desenhado (não é um Pix real e não deve ser escaneável): três
 * marcadores de canto e um miolo de módulos com posições fixas — nada
 * de aleatoriedade, que quebraria a hidratação.
 */
function QrArt() {
  const modules = [
    { x: 3, y: 3 }, { x: 4, y: 3 }, { x: 6, y: 3 }, { x: 8, y: 3 }, { x: 9, y: 3 }, { x: 11, y: 3 },
    { x: 3, y: 4 }, { x: 5, y: 4 }, { x: 7, y: 4 }, { x: 10, y: 4 }, { x: 12, y: 4 },
    { x: 4, y: 5 }, { x: 6, y: 5 }, { x: 8, y: 5 }, { x: 9, y: 5 }, { x: 11, y: 5 }, { x: 13, y: 5 },
    { x: 3, y: 6 }, { x: 5, y: 6 }, { x: 7, y: 6 }, { x: 12, y: 6 },
    { x: 4, y: 7 }, { x: 6, y: 7 }, { x: 9, y: 7 }, { x: 10, y: 7 }, { x: 13, y: 7 },
    { x: 3, y: 8 }, { x: 8, y: 8 }, { x: 11, y: 8 }, { x: 12, y: 8 },
    { x: 5, y: 9 }, { x: 7, y: 9 }, { x: 9, y: 9 }, { x: 13, y: 9 },
    { x: 4, y: 10 }, { x: 6, y: 10 }, { x: 10, y: 10 }, { x: 12, y: 10 },
    { x: 3, y: 11 }, { x: 8, y: 11 }, { x: 9, y: 11 }, { x: 11, y: 11 }, { x: 13, y: 11 },
    { x: 5, y: 12 }, { x: 7, y: 12 }, { x: 10, y: 12 }, { x: 12, y: 12 },
    { x: 4, y: 13 }, { x: 6, y: 13 }, { x: 9, y: 13 }, { x: 11, y: 13 }, { x: 13, y: 13 },
  ];

  const finders = [
    { x: 1, y: 1 },
    { x: 11, y: 1 },
    { x: 1, y: 11 },
  ];

  return (
    <svg viewBox="0 0 17 17" className={styles.qr} aria-hidden="true" focusable="false">
      <rect width="17" height="17" fill="#ffffff" />
      {finders.map(({ x, y }) => (
        <g key={`${x}-${y}`}>
          <rect x={x} y={y} width="5" height="5" fill="#0c1b33" />
          <rect x={x + 1} y={y + 1} width="3" height="3" fill="#ffffff" />
          <rect x={x + 1.75} y={y + 1.75} width="1.5" height="1.5" fill="#0c1b33" />
        </g>
      ))}
      {modules.map(({ x, y }) => (
        <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill="#0c1b33" />
      ))}
    </svg>
  );
}

export function StorefrontDemo() {
  return (
    <div className={styles.demo}>
      {/* Moldura de navegador: dá o contexto de "isso é uma página na
          internet, com link só dela" sem precisar dizer isso em texto. */}
      <div className={styles.browser} data-reveal="lift">
        <div className={styles.browserBar}>
          <span className={styles.dots} aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span className={styles.urlBar}>{getStoreUrlExample()}</span>
        </div>
        <div className={styles.browserViewport}>
          <CatalogScreen />
        </div>
      </div>

      {/* Trilho de telas de celular: rola no toque, com snap. É onde o
          lojista vê o pedido virar dinheiro. */}
      <div className={styles.phones}>
        <figure className={styles.phoneItem} data-reveal style={{ "--reveal-delay": "60ms" } as React.CSSProperties}>
          <div className={styles.phone}>
            <div className={styles.phoneViewport}>
              <CheckoutScreen />
            </div>
          </div>
          <figcaption className={styles.caption}>
            <span className={styles.captionStep}>Passo 2</span>
            Seu cliente fecha o pedido sem criar conta nem senha.
          </figcaption>
        </figure>

        <figure className={styles.phoneItem} data-reveal style={{ "--reveal-delay": "140ms" } as React.CSSProperties}>
          <div className={styles.phone}>
            <div className={styles.phoneViewport}>
              <PaymentScreen />
            </div>
          </div>
          <figcaption className={styles.caption}>
            <span className={styles.captionStep}>Passo 3</span>
            Ele paga o Pix na hora e o pedido cai no seu painel, já confirmado.
          </figcaption>
        </figure>
      </div>
    </div>
  );
}
