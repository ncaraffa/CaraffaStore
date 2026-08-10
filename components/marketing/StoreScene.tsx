import { IconCheck, IconPix, IconShoppingCart } from "@/components/ui/icons";
import styles from "./StoreScene.module.css";

/**
 * Miniatura da loja — a peça de identidade da seção azul.
 *
 * É uma fachada desenhada em SVG (branco, azul-claro e cobalto), não arte de
 * banco de imagens: a placa carrega a própria jarra da marca e a vitrine tem
 * a linha de nível que se repete no produto inteiro. Fica em torno dela um
 * pequeno teatro de comércio acontecendo — pedido chegando, Pix confirmado,
 * item no carrinho — com dados de demonstração.
 *
 * Tudo é vetor + CSS: nenhuma imagem para baixar no celular.
 */
export function StoreScene() {
  return (
    <div className={styles.scene}>
      <div className={styles.halo} aria-hidden="true" />

      <svg
        className={styles.store}
        viewBox="0 0 360 300"
        role="img"
        aria-label="Ilustração de uma pequena loja com vitrine, produtos e uma placa com o símbolo da CaraffaStore"
      >
        <defs>
          <linearGradient id="cs-store-facade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="1" stopColor="#eaf0fb" />
          </linearGradient>
          <linearGradient id="cs-store-glass" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#dbe8ff" />
            <stop offset="1" stopColor="#b9d0ff" />
          </linearGradient>
          <linearGradient id="cs-store-door" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#2e6bff" />
            <stop offset="1" stopColor="#143bd1" />
          </linearGradient>
          <linearGradient id="cs-store-sign" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="1" stopColor="#f0f5ff" />
          </linearGradient>
        </defs>

        {/* Sombra de contato — assenta a loja no chão */}
        <ellipse cx="180" cy="279" rx="132" ry="11" fill="#0c1b33" opacity="0.16" />

        {/* Degrau */}
        <rect x="52" y="262" width="256" height="13" rx="6.5" fill="#c2d6ff" />
        <rect x="52" y="262" width="256" height="5" rx="2.5" fill="#dee9ff" />

        {/* Corpo da fachada */}
        <rect x="62" y="104" width="236" height="158" rx="12" fill="url(#cs-store-facade)" />
        <rect x="62" y="104" width="236" height="158" rx="12" fill="none" stroke="#d3dff2" strokeWidth="1.5" />

        {/* Toldo listrado com barra ondulada */}
        <path d="M52 74h256a8 8 0 0 1 8 8v22H44V82a8 8 0 0 1 8-8Z" fill="#dee9ff" />
        <path d="M92 74h40v30H92zM172 74h40v30h-40zM252 74h40v30h-40z" fill="#1b4dff" opacity="0.82" />
        <path
          d="M44 104h272l-8.5 15a9 9 0 0 1-15.1 0 9 9 0 0 1-15.1 0 9 9 0 0 1-15.1 0 9 9 0 0 1-15.1 0 9 9 0 0 1-15.1 0 9 9 0 0 1-15.1 0 9 9 0 0 1-15.1 0 9 9 0 0 1-15.1 0 9 9 0 0 1-15.1 0 9 9 0 0 1-15.1 0 9 9 0 0 1-15.1 0 9 9 0 0 1-15.1 0 9 9 0 0 1-15.1 0 9 9 0 0 1-15.1 0 9 9 0 0 1-15.1 0L44 104Z"
          fill="#c2d6ff"
        />

        {/* Placa da loja, com a jarra da marca */}
        <rect x="122" y="30" width="116" height="38" rx="10" fill="url(#cs-store-sign)" />
        <rect x="122" y="30" width="116" height="38" rx="10" fill="none" stroke="#d3dff2" strokeWidth="1.5" />
        <g transform="translate(136 38) scale(0.92)" fill="#1b4dff">
          <rect x="8.7" y="2.4" width="6.6" height="2.9" rx="1.45" />
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M9.6 5.1h4.8v3.1c0 1.05.45 2.05 1.24 2.74l2.16 1.96c1.14 1 1.8 2.45 1.8 3.97v.53a3.2 3.2 0 0 1-3.2 3.2H7.6a3.2 3.2 0 0 1-3.2-3.2v-.53c0-1.52.66-2.97 1.8-3.97l2.16-1.96C9.15 10.25 9.6 9.25 9.6 8.2V5.1ZM5.9 13.6h12.2v1.5H5.9v-1.5Z"
          />
        </g>
        <rect x="166" y="42" width="56" height="6" rx="3" fill="#0c1b33" opacity="0.72" />
        <rect x="166" y="53" width="34" height="5" rx="2.5" fill="#64728e" opacity="0.55" />
        {/* Hastes da placa */}
        <rect x="150" y="68" width="4" height="8" rx="2" fill="#c2d6ff" />
        <rect x="206" y="68" width="4" height="8" rx="2" fill="#c2d6ff" />

        {/* Vitrine */}
        <rect x="80" y="126" width="120" height="98" rx="9" fill="url(#cs-store-glass)" />
        <rect x="80" y="126" width="120" height="98" rx="9" fill="none" stroke="#a9c4ff" strokeWidth="1.5" />
        {/* Brilho diagonal do vidro */}
        <path d="M92 224 168 126h22L114 224Z" fill="#ffffff" opacity="0.28" />

        {/* Prateleiras com produtos */}
        <rect x="92" y="166" width="96" height="3" rx="1.5" fill="#ffffff" opacity="0.85" />
        <rect x="92" y="205" width="96" height="3" rx="1.5" fill="#ffffff" opacity="0.85" />
        <rect x="99" y="144" width="17" height="22" rx="3.5" fill="#ffffff" />
        <rect x="124" y="138" width="20" height="28" rx="3.5" fill="#1b4dff" opacity="0.75" />
        <rect x="152" y="147" width="15" height="19" rx="3.5" fill="#ffffff" />
        <circle cx="181" cy="158" r="8" fill="#ffffff" opacity="0.9" />
        <rect x="100" y="186" width="22" height="19" rx="3.5" fill="#ffffff" />
        <rect x="130" y="181" width="16" height="24" rx="3.5" fill="#1b4dff" opacity="0.55" />
        <rect x="154" y="188" width="26" height="17" rx="3.5" fill="#ffffff" />

        {/* Porta */}
        <path d="M216 126h56a8 8 0 0 1 8 8v128h-72V134a8 8 0 0 1 8-8Z" fill="url(#cs-store-door)" />
        <path d="M226 138h36a5 5 0 0 1 5 5v33h-46v-33a5 5 0 0 1 5-5Z" fill="#ffffff" opacity="0.22" />
        <circle cx="230" cy="204" r="4" fill="#ffffff" opacity="0.85" />
        {/* Linha de nível — o motivo da marca, também na porta */}
        <rect x="224" y="228" width="44" height="4" rx="2" fill="#ffffff" opacity="0.28" />
        <rect x="224" y="228" width="27" height="4" rx="2" fill="#ffffff" opacity="0.9" />

        {/* Caixa entregue ao lado da porta */}
        <rect x="296" y="232" width="34" height="30" rx="4" fill="#ffffff" stroke="#d3dff2" strokeWidth="1.5" />
        <path d="M296 244h34" stroke="#c2d6ff" strokeWidth="3" />
        <path d="M313 232v30" stroke="#c2d6ff" strokeWidth="3" />

        {/* Planta — a única forma orgânica da composição */}
        <path d="M38 262h26l-3 -22H41l-3 22Z" fill="#dee9ff" stroke="#c2d6ff" strokeWidth="1.5" />
        <path
          d="M51 240c0-12 7-19 15-21-1 12-6 19-15 21Zm0 0c0-10-6-16-13-18 1 10 5 16 13 18Z"
          fill="#94b6ff"
        />
      </svg>

      {/* Teatro de comércio ao redor da loja — camadas à frente da fachada. */}
      <div className={styles.card} data-card="order">
        <span className={styles.cardIcon} data-tone="blue">
          <IconShoppingCart />
        </span>
        <span className={styles.cardText}>
          <strong>Novo pedido</strong>
          <span>2 itens · Marina A.</span>
        </span>
      </div>

      <div className={styles.card} data-card="pix">
        <span className={styles.cardIcon} data-tone="green">
          <IconPix />
        </span>
        <span className={styles.cardText}>
          <strong>Pix confirmado</strong>
          <span className={styles.cardValue}>R$ 189,90</span>
        </span>
      </div>

      <div className={styles.card} data-card="stock">
        <span className={styles.cardIcon} data-tone="blue">
          <IconCheck />
        </span>
        <span className={styles.cardText}>
          <strong>Estoque atualizado</strong>
          <span>Baixa automática</span>
        </span>
      </div>
    </div>
  );
}
