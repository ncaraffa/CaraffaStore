import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { color, font, radius } from "../lib/theme";
import { pop, progress } from "../lib/timing";
import { PhoneFrame } from "../components/Device";
import { PixScreen } from "../components/StorefrontScreens";

/**
 * Cena 5 — o momento de recompensa.
 *
 * É a única vez no filme em que algo usa mola de verdade: o selo verde
 * cresce e assenta. Damping alto, uma oscilação só — um check que quica
 * três vezes viraria desenho animado e mataria a credibilidade que o
 * resto do vídeo constrói.
 *
 * O aparelho continua exatamente no lugar e no tamanho da cena
 * anterior: o QR apaga por baixo do selo em vez de a tela trocar. É a
 * diferença entre "o pagamento foi confirmado" e "cortou para outra
 * tela".
 *
 * O halo verde é curto e some. Nada de confete, nada de partícula.
 */
export const Scene05PixConfirmed: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const approveAt = 0.4;
  const approved = Math.min(1, pop(frame, approveAt, fps));

  const haloT = progress(frame, approveAt, 1.1, (t) => t);
  const haloOpacity = haloT > 0 ? Math.sin(Math.PI * haloT) * 0.5 : 0;

  const label = progress(frame, approveAt + 0.3, 0.55);

  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <div
        style={{
          position: "absolute",
          width: 900,
          height: 900,
          borderRadius: 999,
          background: `radial-gradient(circle, rgba(14, 159, 110, 0.16), transparent 62%)`,
          opacity: haloOpacity,
        }}
      />

      {/* Mesma linha centralizada e mesmo tamanho de aparelho da cena 4 —
          é o que faz o corte entre as duas parecer continuação. */}
      <div style={{ display: "flex", alignItems: "center", gap: 88 }}>
        <div style={{ flex: "none" }}>
          <PhoneFrame width={430} height={760}>
            <PixScreen reveal={1} approved={approved} />
          </PhoneFrame>
        </div>

        <div
          style={{
            width: 520,
            flex: "none",
            opacity: label,
            transform: `translateX(${(1 - label) * -18}px)`,
          }}
        >
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 12,
              padding: "12px 20px",
              borderRadius: radius.full,
              background: color.successBg,
              border: `1px solid ${color.successBorder}`,
              marginBottom: 22,
              whiteSpace: "nowrap",
            }}
          >
            <span style={{ width: 9, height: 9, borderRadius: 999, background: color.success }} />
            <span style={{ fontFamily: font.sans, fontSize: 17, fontWeight: 600, color: color.successText }}>
              Pix recebido
            </span>
          </div>

          <div
            style={{
              fontFamily: font.display,
              fontWeight: 700,
              fontSize: 60,
              lineHeight: 1.06,
              letterSpacing: "-0.03em",
              color: color.ink,
            }}
          >
            Pagamento
            <br />
            confirmado.
          </div>

          <div
            style={{
              marginTop: 22,
              fontFamily: font.sans,
              fontSize: 21,
              lineHeight: 1.5,
              color: color.inkMuted,
            }}
          >
            Direto na sua conta do Mercado Pago,
            <br />
            sem comissão da CaraffaStore.
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
