import { CaraffaMark } from "@/components/ui/Logo";
import { IconCheck } from "@/components/ui/icons";
import styles from "./ConversationScene.module.css";

/**
 * O momento humano da página.
 *
 * Para quem vende no bairro, no direct e no grupo da família, a venda começa
 * numa conversa — o link da loja mandado para o cliente. Esta cena mostra
 * exatamente isso, com a pessoa de um lado, o lojista do outro e o pedido
 * fechando no meio.
 *
 * É desenhada em HTML/CSS com o próprio vocabulário do produto (o card de
 * link é o mesmo `/loja/slug` que existe de verdade). Não há foto de banco
 * de imagens nem pessoa real: os avatares são formas abstratas.
 */

function Avatar({ tone, label }: { tone: "merchant" | "customer"; label: string }) {
  return (
    <span className={styles.avatar} data-tone={tone} title={label} aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="currentColor">
        <circle cx="12" cy="8.6" r="4.1" />
        <path d="M3.8 21.2a8.2 8.2 0 0 1 16.4 0 1 1 0 0 1-1 1H4.8a1 1 0 0 1-1-1Z" />
      </svg>
    </span>
  );
}

export function ConversationScene() {
  return (
    <div className={styles.scene}>
      <div className={styles.thread} role="img" aria-label="Conversa de exemplo: a lojista envia o link da loja e a cliente confirma o pedido pago por Pix">
        <div className={styles.row} data-from="merchant">
          <Avatar tone="merchant" label="Lojista" />
          <div className={styles.bubble} data-from="merchant">
            <p>Oi, Marina! Chegou café novo. O catálogo já está no ar.</p>
          </div>
        </div>

        {/* Prévia do link — o mesmo endereço /loja/slug que o produto gera. */}
        <div className={styles.row} data-from="merchant">
          <span className={styles.avatarSpacer} aria-hidden="true" />
          <div className={styles.linkCard}>
            <span className={styles.linkMark}>
              <CaraffaMark />
            </span>
            <span className={styles.linkText}>
              <strong>Casa do Café</strong>
              <span>/loja/casa-do-cafe</span>
            </span>
          </div>
        </div>

        <div className={styles.row} data-from="customer">
          <div className={styles.bubble} data-from="customer">
            <p>Amei! Já pedi dois pacotes e paguei no Pix.</p>
          </div>
          <Avatar tone="customer" label="Cliente" />
        </div>

        {/* O sistema fecha a conversa: o pedido caiu no painel. */}
        <div className={styles.systemLine}>
          <span className={styles.systemIcon}>
            <IconCheck />
          </span>
          Pedido <span className={styles.systemCode}>#8F42A1</span> pago · estoque baixado
        </div>
      </div>

      <p className={styles.caption}>Conversa de demonstração</p>
    </div>
  );
}
