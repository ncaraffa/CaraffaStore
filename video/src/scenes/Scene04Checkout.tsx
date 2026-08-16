import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { color, font, radius, shadow } from "../lib/theme";
import { EASE_OUT, progress, sec } from "../lib/timing";
import { PhoneFrame } from "../components/Device";
import { CheckoutScreen, PixScreen } from "../components/StorefrontScreens";
import { TouchRing } from "../components/Pointer";
import { MonoLabel } from "../components/ui";

/**
 * Cena 4 — fechar o pedido e chegar no Pix.
 *
 * Troca de aparelho de propósito: o lojista trabalha no navegador, o
 * cliente paga no celular. É como a compra realmente acontece quando o
 * link chega pelo WhatsApp, e o corte comunica isso sem legenda.
 *
 * Os campos aparecem preenchendo rápido, não sendo digitados letra a
 * letra em tempo real — o assunto é o fluxo, não a datilografia. Os
 * campos exibidos são os que o checkout real pede.
 *
 * A tela de Pix substitui a de checkout dentro do MESMO aparelho: o
 * telefone não se move, só o conteúdo. É o que faz parecer navegação de
 * verdade em vez de duas cenas coladas.
 *
 * Aparelho e texto vivem numa linha centralizada. Na primeira versão o
 * telefone era centrado e o texto empurrado para fora, o que jogava todo
 * o peso da composição para a direita.
 */
export const Scene04Checkout: React.FC = () => {
  const frame = useCurrentFrame();

  const enter = progress(frame, 0, 0.7, EASE_OUT);

  // Preenchimento dos três campos entre 0,5s e 2,0s.
  const typed = interpolate(frame, [sec(0.5), sec(1.1), sec(1.6), sec(2.0)], [0, 1, 2, 3], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const tapAt = 2.45;
  const pressed = frame >= sec(tapAt) && frame < sec(tapAt + 0.14) ? 1 : 0;

  const toPix = progress(frame, tapAt + 0.12, 0.4, EASE_OUT);
  const qrReveal = progress(frame, tapAt + 0.3, 0.45, EASE_OUT);

  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 88,
          opacity: enter,
          transform: `translateY(${(1 - enter) * 42}px) scale(${0.97 + enter * 0.03})`,
        }}
      >
        <div style={{ position: "relative", flex: "none" }}>
          <PhoneFrame width={430} height={760}>
            {/* Checkout saindo */}
            <div style={{ position: "absolute", inset: 0, opacity: 1 - toPix }}>
              <CheckoutScreen typed={typed} pressed={pressed} />
            </div>
            {/* Pix entrando */}
            <div
              style={{
                position: "absolute",
                inset: 0,
                opacity: toPix,
                transform: `translateY(${(1 - toPix) * 16}px)`,
              }}
            >
              <PixScreen reveal={qrReveal} />
            </div>

            {/* O anel só existe enquanto o checkout está na tela, e em
                cima do botão que ele representa. Solto sobre a tela de
                Pix, virava um círculo perdido no vazio. */}
            {toPix < 0.5 && <TouchRing x={205} y={612} frame={frame} atSeconds={tapAt} />}
          </PhoneFrame>
        </div>

        {/* Coluna de texto — largura explícita, senão o valor quebra em
            "R$" numa linha e "39,90" na outra. */}
        <div style={{ width: 520, flex: "none" }}>
          <div
            style={{
              opacity: progress(frame, 0.4, 0.6),
              transform: `translateX(${(1 - progress(frame, 0.4, 0.6)) * -18}px)`,
            }}
          >
            <MonoLabel size={15}>Pedido #1042</MonoLabel>
            <div
              style={{
                marginTop: 12,
                fontFamily: font.display,
                fontWeight: 700,
                fontSize: 68,
                lineHeight: 1,
                letterSpacing: "-0.03em",
                color: color.ink,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              R$ 39,90
            </div>
            <div
              style={{
                marginTop: 18,
                fontFamily: font.sans,
                fontSize: 21,
                lineHeight: 1.5,
                color: color.inkMuted,
              }}
            >
              Sem criar conta, sem baixar aplicativo.
            </div>
          </div>

          <div
            style={{
              marginTop: 30,
              display: "inline-flex",
              alignItems: "center",
              gap: 12,
              padding: "13px 20px",
              borderRadius: radius.full,
              background: color.white,
              border: `1px solid ${color.line}`,
              boxShadow: shadow.sm,
              whiteSpace: "nowrap",
              opacity: toPix,
              transform: `translateY(${(1 - toPix) * 10}px)`,
            }}
          >
            <span style={{ width: 9, height: 9, borderRadius: 999, background: color.warning }} />
            <span style={{ fontFamily: font.sans, fontSize: 17, color: color.inkBody }}>Pague com Pix</span>
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
