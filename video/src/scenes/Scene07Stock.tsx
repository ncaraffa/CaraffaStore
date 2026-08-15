import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { color, font, radius, shadow } from "../lib/theme";
import { EASE_OUT, progress, rise } from "../lib/timing";
import { BrowserFrame } from "../components/Device";
import { ProductsStockScreen } from "../components/DashboardScreens";
import { MonoLabel } from "../components/ui";

/**
 * Cena 7 — o estoque conversa com a venda.
 *
 * A cena mais curta do filme, porque a ideia é curta: um número trocou
 * sozinho. O 12 sobe e sai, o 11 entra por baixo — sem seta, sem
 * legenda "estoque atualizado automaticamente", sem gráfico. Se o
 * espectador viu o pedido entrar na cena anterior e vê o número cair
 * aqui, a ligação já está feita.
 *
 * Um zoom lento aproxima a coluna de estoque para que a troca aconteça
 * onde o olho já está.
 */
export const Scene07Stock: React.FC = () => {
  const frame = useCurrentFrame();

  const flip = progress(frame, 1.1, 0.55, EASE_OUT);

  // Zoom discreto em direção à coluna de estoque (à direita do centro).
  // 1.05, não 1.09: com o zoom maior a moldura crescia para cima e
  // encostava no rótulo da cena.
  const zoom = 1 + progress(frame, 0.3, 2.4, EASE_OUT) * 0.05;
  const shiftX = -progress(frame, 0.3, 2.4, EASE_OUT) * 90;

  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
      <div style={{ position: "relative", ...rise(frame, 0, 0.45, 18) }}>
        <div style={{ transform: `translateX(${shiftX}px) scale(${zoom})` }}>
          <BrowserFrame url="caraffastore.com.br/dashboard/products" width={1240} height={800}>
            <ProductsStockScreen stockFlip={flip} />
          </BrowserFrame>
        </div>

        <div
          style={{
            position: "absolute",
            top: -62,
            left: 4,
            display: "flex",
            alignItems: "center",
            gap: 12,
            ...rise(frame, 0.05, 0.45, 10),
          }}
        >
          <span style={{ width: 8, height: 8, borderRadius: 999, background: color.blue600 }} />
          <MonoLabel size={14}>E o estoque acompanha</MonoLabel>
        </div>

        {/* Selo de baixa: entra junto com a troca do número e some com a
            cena. É a única "explicação" da cena, e ela cabe em duas
            palavras. */}
        <div
          style={{
            position: "absolute",
            right: -30,
            top: 470,
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "12px 18px",
            borderRadius: radius.full,
            background: color.white,
            border: `1px solid ${color.blue200}`,
            boxShadow: shadow.lg,
            opacity: progress(frame, 1.25, 0.4),
            transform: `translateY(${(1 - progress(frame, 1.25, 0.4)) * 10}px)`,
          }}
        >
          <span
            style={{
              fontFamily: font.mono,
              fontSize: 15,
              fontWeight: 600,
              color: color.blue700,
            }}
          >
            −1
          </span>
          <span style={{ fontFamily: font.sans, fontSize: 15, color: color.inkBody }}>baixa automática</span>
        </div>
      </div>
    </AbsoluteFill>
  );
};
