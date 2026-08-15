import React from "react";
import { interpolate } from "remotion";
import { EASE_IN_OUT, sec } from "../lib/timing";
import { color } from "../lib/theme";

/**
 * Cursor de desktop e toque de celular.
 *
 * Regra do briefing, e também bom senso: nada de círculo gigante
 * pulsando a cada ação. O cursor é pequeno e opaco; o toque é um anel
 * fino que abre uma vez e some. O que comunica a interação é a REAÇÃO da
 * interface, não o indicador.
 */

/** Ponteiro de seta, desenhado — não emoji, não asset externo. */
export const Cursor: React.FC<{
  x: number;
  y: number;
  opacity?: number;
  scale?: number;
}> = ({ x, y, opacity = 1, scale = 1 }) => (
  <div
    style={{
      position: "absolute",
      left: x,
      top: y,
      opacity,
      transform: `scale(${scale})`,
      transformOrigin: "top left",
      pointerEvents: "none",
      filter: "drop-shadow(0 3px 6px rgba(12, 27, 51, 0.28))",
    }}
  >
    <svg width={26} height={30} viewBox="0 0 26 30" fill="none">
      <path d="M2 1.6 21.4 15.2l-8.4.9 4.6 9.3-3.6 1.8-4.6-9.3-5.6 5.6L2 1.6Z" fill="#ffffff" />
      <path
        d="M2 1.6 21.4 15.2l-8.4.9 4.6 9.3-3.6 1.8-4.6-9.3-5.6 5.6L2 1.6Z"
        stroke={color.ink}
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  </div>
);

/**
 * Move o cursor de A até B entre dois instantes, com aceleração e
 * desaceleração — um cursor que anda em velocidade constante parece
 * script, não mão.
 */
export function cursorPath(
  frame: number,
  from: { x: number; y: number },
  to: { x: number; y: number },
  startSeconds: number,
  durationSeconds: number,
): { x: number; y: number } {
  const t = interpolate(frame, [sec(startSeconds), sec(startSeconds + durationSeconds)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const e = EASE_IN_OUT(t);
  return { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e };
}

/** Anel de toque: abre uma vez, some. Sem repetição, sem pulso. */
export const TouchRing: React.FC<{
  x: number;
  y: number;
  frame: number;
  atSeconds: number;
}> = ({ x, y, frame, atSeconds }) => {
  const start = sec(atSeconds);
  const life = sec(0.6);
  if (frame < start || frame > start + life) return null;

  const t = (frame - start) / life;
  const size = 22 + t * 44;
  const opacity = (1 - t) * 0.55;

  return (
    <>
      <div
        style={{
          position: "absolute",
          left: x - size / 2,
          top: y - size / 2,
          width: size,
          height: size,
          borderRadius: 999,
          border: `2px solid ${color.blue600}`,
          opacity,
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: x - 9,
          top: y - 9,
          width: 18,
          height: 18,
          borderRadius: 999,
          background: color.blue600,
          opacity: Math.max(0, 0.5 - t),
          pointerEvents: "none",
        }}
      />
    </>
  );
};
