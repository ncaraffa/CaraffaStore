import { IconLink, IconPix } from "@/components/ui/icons";
import styles from "./HeroScene.module.css";

/**
 * Cena de produto do hero.
 *
 * Não é um screenshot nem um placeholder cinza: é a própria interface da
 * CaraffaStore remontada em HTML/CSS, em camadas de elevação diferentes —
 * o painel de pedidos ao fundo, a confirmação de Pix e o nível de estoque
 * flutuando à frente. Os dados são de demonstração e estão rotulados como
 * tal; nenhuma métrica aqui é apresentada como resultado real de ninguém.
 */

const DEMO_ORDERS = [
  { code: "8F42A1", customer: "Marina Alves", total: "R$ 189,90", tone: "paid", status: "Pago" },
  { code: "7C09E5", customer: "Rafael Lima", total: "R$ 64,00", tone: "pending", status: "Aguardando Pix" },
  { code: "6B31D8", customer: "Júlia Marques", total: "R$ 232,50", tone: "paid", status: "Pago" },
  { code: "5A78C2", customer: "Diego Sartori", total: "R$ 98,00", tone: "paid", status: "Pago" },
  { code: "4E10B9", customer: "Helena Prado", total: "R$ 145,00", tone: "pending", status: "Aguardando Pix" },
] as const;

export function HeroScene() {
  return (
    <div className={styles.scene}>
      <div className={styles.glow} aria-hidden="true" />

      <div className={styles.panel} aria-hidden="true">
        <div className={styles.panelBar}>
          <span className={styles.panelStore}>Casa do Café</span>
          <span className={styles.panelBadge}>Ativa</span>
          <span className={styles.panelUrl}>
            <IconLink />
            /loja/casa-do-cafe
          </span>
        </div>

        <div className={styles.panelBody}>
          <div className={styles.metrics}>
            <div className={styles.metric}>
              <span className={styles.metricLabel}>Pedidos hoje</span>
              <span className={styles.metricValue}>7</span>
            </div>
            <div className={styles.metric}>
              <span className={styles.metricLabel}>Recebido</span>
              <span className={styles.metricValue}>R$ 1.284</span>
            </div>
            <div className={styles.metric} data-attention="true">
              <span className={styles.metricLabel}>Aguardando Pix</span>
              <span className={styles.metricValue}>2</span>
            </div>
          </div>

          <div className={styles.tableHead}>
            <span>Pedido</span>
            <span>Cliente</span>
            <span>Valor</span>
          </div>

          {DEMO_ORDERS.map((order) => (
            <div key={order.code} className={styles.row}>
              <span className={styles.rowCode}>#{order.code}</span>
              <span className={styles.rowCustomer}>{order.customer}</span>
              <span className={styles.rowTotal}>{order.total}</span>
              <span className={styles.rowStatus} data-tone={order.tone}>
                {order.status}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Confirmação de pagamento — a camada mais à frente. */}
      <div className={styles.pixCard} aria-hidden="true">
        <span className={styles.pixIcon}>
          <IconPix />
        </span>
        <span className={styles.pixText}>
          <strong>Pagamento confirmado</strong>
          <span>
            Pix · <span className={styles.pixCode}>#8F42A1</span>
          </span>
        </span>
        <span className={styles.pixValue}>R$ 189,90</span>
      </div>

      {/* Nível de estoque — o mesmo motivo de "nível" do símbolo da marca. */}
      <div className={styles.stockCard} aria-hidden="true">
        <span className={styles.stockName}>Café Especial 250g</span>
        <span className={styles.stockLevel}>
          <span className={styles.stockFill} />
        </span>
        <span className={styles.stockCount}>12 em estoque</span>
      </div>

      <p className={styles.caption}>Interface de demonstração</p>
    </div>
  );
}
