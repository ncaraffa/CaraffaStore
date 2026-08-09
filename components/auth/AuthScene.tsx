import { CaraffaMark } from "@/components/ui/Logo";
import { IconCheck, IconPix, IconShoppingCart } from "@/components/ui/icons";
import styles from "./AuthScene.module.css";

/**
 * Painel visual da autenticação — metade esquerda do split-screen em
 * telas largas, oculto no celular (o formulário vem primeiro lá).
 *
 * Não é a HeroScene da landing reaproveitada: a composição é vertical e
 * mais contida, pensada para uma coluna estreita, não para um hero largo.
 * O que se repete de propósito é o vocabulário da marca — a jarra como
 * marca d'água, a linha de nível como barra de estoque, cartões de
 * comércio acontecendo — porque é isso que faz esta tela parecer a MESMA
 * CaraffaStore da landing, não uma tela nova inventada.
 */
export function AuthScene() {
  return (
    <div className={styles.scene}>
      <div className={styles.glow} aria-hidden="true" />
      <CaraffaMark className={styles.watermark} />

      <div className={styles.top}>
        <p className={styles.eyebrow}>Painel CaraffaStore</p>
        <h2 className={styles.title}>Sua loja, sempre à mão.</h2>
        <p className={styles.lead}>
          Pedidos, estoque e Pix — tudo no mesmo painel que você vai acessar agora.
        </p>
      </div>

      {/* Composição narrow: os mesmos elementos da cena do hero da
          landing, remontados numa coluna estreita — não é o mesmo
          componente reaproveitado, é a mesma linguagem reaplicada. */}
      <div className={styles.panel} aria-hidden="true">
        <div className={styles.panelHead}>
          <span className={styles.panelStore}>Casa do Café</span>
          <span className={styles.panelBadge}>Ativa</span>
        </div>

        <div className={styles.orderRow}>
          <span className={styles.orderIcon}>
            <IconShoppingCart />
          </span>
          <span className={styles.orderText}>
            <strong>Pedido #8F42A1</strong>
            <span>2 itens · Marina A.</span>
          </span>
          <span className={styles.orderValue}>R$ 189,90</span>
        </div>

        <div className={styles.pixRow}>
          <span className={styles.pixIcon}>
            <IconPix />
          </span>
          Pix confirmado agora
        </div>

        <div className={styles.stockRow}>
          <span>Café Especial 250g</span>
          <span className={styles.stockLevel}>
            <span className={styles.stockFill} />
          </span>
        </div>
      </div>

      <ul className={styles.facts}>
        <li>
          <IconCheck /> Pix direto na sua conta
        </li>
        <li>
          <IconCheck /> Sem comissão por venda
        </li>
        <li>
          <IconCheck /> Sem cartão para começar
        </li>
      </ul>
    </div>
  );
}
