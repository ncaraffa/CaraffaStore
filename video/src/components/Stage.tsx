import React from "react";
import { AbsoluteFill } from "remotion";
import { color, font } from "../lib/theme";

/* ============================================================
   Enquadramento

   O filme mostra interface de produto, e interface de produto tem
   texto de 13–15px. Num master 1920 isso é confortável; embutido numa
   landing a 1100px vira 8px, e num celular a 390px vira 3px — ilegível.
   Medido, não estimado.

   A saída não é aumentar a fonte da interface (isso deixaria de ser o
   produto real): é aproximar a câmera. Estes dois helpers são o
   vocabulário de câmera do filme.
   ============================================================ */

/**
 * Posiciona uma "tela" (moldura de navegador ou celular) escalada e
 * deslocada para que um ponto de interesse dela caia no centro do
 * quadro.
 *
 * `focus` é dado em coordenadas LOCAIS da moldura — o mesmo sistema em
 * que o cursor é posicionado —, então mirar num botão é ler a
 * coordenada dele uma vez e reusar.
 *
 * Deixar a moldura sangrar para fora do quadro é intencional em
 * close-up: cortar nos quatro lados lê como aproximação; cortar num
 * lado só lê como erro de composição.
 */
export const CameraFrame: React.FC<{
  width: number;
  height: number;
  scale: number;
  focus?: { x: number; y: number };
  children: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ width, height, scale, focus, children, style }) => {
  const fx = focus ? focus.x - width / 2 : 0;
  const fy = focus ? focus.y - height / 2 : 0;

  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", ...style }}>
      <div
        style={{
          width,
          height,
          flex: "none",
          transform: `translate(${-fx * scale}px, ${-fy * scale}px) scale(${scale})`,
          transformOrigin: "center center",
        }}
      >
        {children}
      </div>
    </AbsoluteFill>
  );
};

/**
 * Rótulo de cena, ancorado em posição FIXA do quadro.
 *
 * Antes ele era posicionado em relação à moldura; quando a moldura
 * passou a crescer, os dois começaram a se encostar. Preso ao quadro,
 * a colisão deixa de ser possível por construção.
 */
export const SceneLabel: React.FC<{
  children: React.ReactNode;
  tone?: string;
  top?: number;
  left?: number;
  opacity?: number;
  transform?: string;
  size?: number;
}> = ({ children, tone = color.blue600, top = 46, left = 300, opacity = 1, transform, size = 15 }) => (
  <div
    style={{
      position: "absolute",
      top,
      left,
      display: "flex",
      alignItems: "center",
      gap: 12,
      opacity,
      transform,
      whiteSpace: "nowrap",
    }}
  >
    <span style={{ width: 9, height: 9, borderRadius: 999, background: tone, flex: "none" }} />
    <span
      style={{
        fontFamily: font.mono,
        fontSize: size,
        fontWeight: 500,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        color: color.inkMuted,
      }}
    >
      {children}
    </span>
  </div>
);

/**
 * Selo flutuante de anotação — usado quando a cena precisa de UMA
 * palavra de contexto que não cabe dentro da interface. É anotação
 * sobre o produto, nunca UI falsa dentro dele.
 */
export const Callout: React.FC<{
  children: React.ReactNode;
  opacity?: number;
  transform?: string;
  style?: React.CSSProperties;
  tone?: "blue" | "green";
}> = ({ children, opacity = 1, transform, style, tone = "blue" }) => (
  <div
    style={{
      position: "absolute",
      display: "inline-flex",
      alignItems: "center",
      gap: 12,
      padding: "16px 26px",
      borderRadius: 999,
      background: color.white,
      border: `1px solid ${tone === "blue" ? color.blue200 : color.successBorder}`,
      boxShadow: "0 8px 16px -4px rgba(12, 27, 51, 0.07), 0 36px 80px -20px rgba(12, 27, 51, 0.22)",
      fontFamily: font.sans,
      fontSize: 22,
      fontWeight: 500,
      color: color.inkBody,
      whiteSpace: "nowrap",
      opacity,
      transform,
      ...style,
    }}
  >
    {children}
  </div>
);
