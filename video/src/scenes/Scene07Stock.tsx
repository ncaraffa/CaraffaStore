import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { color, font } from "../lib/theme";
import { EASE_OUT, progress } from "../lib/timing";
import { BrowserFrame } from "../components/Device";
import { ProductsStockScreen } from "../components/DashboardScreens";
import { CameraFrame } from "../components/Stage";

const W = 1240;
const H = 700;

/**
 * Célula de estoque da linha do Café Especial, em coordenadas locais da
 * moldura. É para cá que a câmera vai.
 */
const STOCK_CELL = { x: 700, y: 300 };

/**
 * Cena 7 — o estoque conversa com a venda.
 *
 * Era a cena mais fraca do filme: o número trocava, mas media 15px num
 * quadro de 1920 — 3px num celular. Ninguém ia perceber o que era para
 * ser o fecho do argumento.
 *
 * Agora a câmera fecha de verdade na linha do produto (fator ~1,9). A
 * moldura sangra pelos quatro lados, o que lê como aproximação e não
 * como corte errado, e a linha do Café Especial fica sozinha no centro
 * do quadro no momento em que o 12 vira 11.
 *
 * A microcopy aparece uma vez, embaixo, e some com a cena: a leitura
 * pretendida é "pedido pago → estoque baixou", e isso precisa de uma
 * linha de texto, não de um painel de explicação.
 */
export const Scene07Stock: React.FC = () => {
  const frame = useCurrentFrame();

  const enter = progress(frame, 0, 0.45, EASE_OUT);

  // Aproximação contínua: começa no mesmo enquadramento da cena 6 (para
  // o corte parecer continuação do painel) e fecha na linha.
  const push = progress(frame, 0.15, 1.4, EASE_OUT);
  const scale = 1.3 + push * 0.62;

  const focusX = interpolate(push, [0, 1], [730, STOCK_CELL.x], { extrapolateRight: "clamp" });
  const focusY = interpolate(push, [0, 1], [400, STOCK_CELL.y], { extrapolateRight: "clamp" });

  // A troca acontece já em close, não durante a aproximação.
  const flip = progress(frame, 1.35, 0.5, EASE_OUT);

  const captionIn = progress(frame, 1.55, 0.45);
  const captionOut = 1 - progress(frame, 2.7, 0.3);
  const caption = Math.min(captionIn, captionOut);

  return (
    <AbsoluteFill>
      <CameraFrame width={W} height={H} scale={scale} focus={{ x: focusX, y: focusY }} style={{ opacity: enter }}>
        <BrowserFrame url="caraffastore.com.br/dashboard/products" width={W} height={H}>
          <ProductsStockScreen stockFlip={flip} />
        </BrowserFrame>
      </CameraFrame>

      {/* Microcopy única da cena, ancorada ao quadro. */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 72,
          display: "flex",
          justifyContent: "center",
          opacity: caption,
          transform: `translateY(${(1 - caption) * 14}px)`,
        }}
      >
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 16,
            padding: "18px 30px",
            borderRadius: 999,
            background: color.white,
            border: `1px solid ${color.blue200}`,
            boxShadow: "0 8px 16px -4px rgba(12, 27, 51, 0.07), 0 36px 80px -20px rgba(12, 27, 51, 0.22)",
          }}
        >
          <span
            style={{
              fontFamily: font.mono,
              fontSize: 24,
              fontWeight: 600,
              color: color.blue700,
              letterSpacing: "-0.02em",
            }}
          >
            −1
          </span>
          <span style={{ width: 1, height: 24, background: color.line }} />
          <span style={{ fontFamily: font.sans, fontSize: 23, color: color.inkBody }}>
            Estoque atualizado automaticamente
          </span>
        </div>
      </div>
    </AbsoluteFill>
  );
};
