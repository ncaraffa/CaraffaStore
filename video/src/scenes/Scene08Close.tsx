import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { color, font, radius, shadow } from "../lib/theme";
import { progress, rise } from "../lib/timing";
import { Logo } from "../components/Brand";
import { PrimaryButton } from "../components/ui";

/**
 * Cena 8 — fechamento.
 *
 * A composição limpa e volta ao centro, na mesma escala tipográfica da
 * abertura: é o que faz o loop funcionar. Quando o vídeo reinicia, o
 * olho sai de uma frase em display centralizada e entra em outra frase
 * em display — nenhum solavanco, mesmo sem loop matematicamente
 * perfeito.
 *
 * O CTA reproduz o botão real da landing (mesmo gradiente, mesmo raio,
 * mesmo glow cobalto), então quem termina o vídeo já sabe qual botão
 * procurar na página.
 */
export const Scene08Close: React.FC = () => {
  const frame = useCurrentFrame();

  const line = (delay: number) => rise(frame, delay, 0.6, 18);

  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <div style={{ width: 1320, display: "flex", flexDirection: "column", alignItems: "center" }}>
        <div style={{ ...line(0.05), marginBottom: 34 }}>
          <Logo scale={1.15} />
        </div>

        <div
          style={{
            fontFamily: font.display,
            fontWeight: 700,
            fontSize: 76,
            lineHeight: 1.06,
            letterSpacing: "-0.03em",
            color: color.ink,
            textAlign: "center",
          }}
        >
          <span style={{ display: "inline-block", ...line(0.18) }}>Sua loja.</span>{" "}
          <span style={{ display: "inline-block", ...line(0.3) }}>Seus pedidos.</span>{" "}
          <span style={{ display: "inline-block", color: color.blue600, ...line(0.42) }}>Seu Pix.</span>
        </div>

        <div
          style={{
            marginTop: 22,
            fontFamily: font.sans,
            fontSize: 23,
            color: color.inkMuted,
            textAlign: "center",
            ...line(0.55),
          }}
        >
          Mensalidade fixa, sem comissão sobre as vendas.
        </div>

        <div style={{ marginTop: 44, ...line(0.68) }}>
          <div style={{ width: 268 }}>
            <PrimaryButton height={62} fontSize={19}>
              Crie sua loja
            </PrimaryButton>
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
