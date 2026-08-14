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

const PRODUCTS = [
  { name: "Café em grãos · Cerrado 500g", price: "R$ 42,00", art: "bag" as const },
  { name: "Moedor manual em inox", price: "R$ 129,90", art: "grinder" as const },
  { name: "Coador de pano tradicional", price: "R$ 24,50", art: "filter" as const },
  { name: "Caneca de cerâmica 300ml", price: "R$ 38,00", art: "mug" as const, soldOut: true },
];

function ProductArt({ kind }: { kind: "bag" | "grinder" | "filter" | "mug" }) {
  return (
    <svg viewBox="0 0 120 120" className={styles.art} aria-hidden="true" focusable="false">
      <rect width="120" height="120" fill="#f1ece6" />
      {kind === "bag" && (
        <>
          <path d="M40 34h40l6 56a8 8 0 0 1-8 9H42a8 8 0 0 1-8-9l6-56Z" fill="#4a3628" />
          <path d="M40 34h40l1.4 13H38.6L40 34Z" fill="#33251b" />
          <rect x="46" y="58" width="28" height="4" rx="2" fill="#d8c3a5" />
          <rect x="46" y="68" width="18" height="4" rx="2" fill="#8d7358" />
          <path d="M44 26h32l-4 8H48l-4-8Z" fill="#6b503b" />
        </>
      )}
      {kind === "grinder" && (
        <>
          <rect x="40" y="52" width="40" height="42" rx="6" fill="#b9bec6" />
          <rect x="40" y="52" width="40" height="10" rx="5" fill="#8f959e" />
          <rect x="44" y="70" width="32" height="18" rx="4" fill="#6f4b32" />
          <rect x="57" y="24" width="6" height="30" rx="3" fill="#8f959e" />
          <rect x="52" y="20" width="26" height="6" rx="3" fill="#5c626b" />
        </>
      )}
      {kind === "filter" && (
        <>
          <path d="M38 44h44l-14 30H52L38 44Z" fill="#efe7dc" />
          <path d="M38 44h44l-3 7H41l-3-7Z" fill="#d9cec0" />
          <rect x="57" y="74" width="6" height="18" rx="3" fill="#8d7358" />
          <ellipse cx="60" cy="94" rx="16" ry="5" fill="#c9bcab" />
        </>
      )}
      {kind === "mug" && (
        <>
          <path d="M38 42h38v34a14 14 0 0 1-14 14H52a14 14 0 0 1-14-14V42Z" fill="#ffffff" />
          <path d="M38 42h38v9H38z" fill="#1b4dff" opacity="0.75" />
          <path d="M76 52h8a10 10 0 0 1 0 20h-8" fill="none" stroke="#ffffff" strokeWidth="7" />
          <path d="M76 52h8a10 10 0 0 1 0 20h-8" fill="none" stroke="#dcd3c8" strokeWidth="3" />
        </>
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
          internet, com endereço próprio" sem precisar dizer isso em texto. */}
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
