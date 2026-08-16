import { interpolate, spring } from "remotion";
import { VIDEO } from "./theme";

/**
 * Vocabulário de movimento do filme.
 *
 * Uma curva só para tudo que é "entrada de interface" (a mesma
 * `--cs-ease-out` do site, cubic-bezier(0.16, 1, 0.3, 1)) e uma para
 * transição de cena. Sem bounce, sem elástico: o produto é calmo, e o
 * vídeo precisa parecer o produto.
 */

/** cubic-bezier(0.16, 1, 0.3, 1) — a curva de entrada do site. */
export const EASE_OUT = (t: number): number => {
  // Aproximação numérica suficiente para movimento de UI, sem depender
  // de resolvedor de bezier a cada frame.
  return 1 - Math.pow(1 - t, 3.2);
};

/** Suave nos dois lados — para pans e zooms longos. */
export const EASE_IN_OUT = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

export const sec = (seconds: number): number => Math.round(seconds * VIDEO.fps);

/**
 * Progresso 0→1 de uma animação que começa em `delay` e dura `duration`
 * (ambos em segundos, relativos ao frame local da sequência).
 */
export function progress(
  frame: number,
  delaySeconds: number,
  durationSeconds: number,
  easing: (t: number) => number = EASE_OUT,
): number {
  const start = sec(delaySeconds);
  const end = start + sec(durationSeconds);
  const raw = interpolate(frame, [start, end], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return easing(raw);
}

/** Entrada padrão de card/painel: sobe alguns px e ganha opacidade. */
export function rise(
  frame: number,
  delaySeconds: number,
  durationSeconds = 0.55,
  distance = 26,
): { opacity: number; transform: string } {
  const p = progress(frame, delaySeconds, durationSeconds);
  return {
    opacity: p,
    transform: `translateY(${(1 - p) * distance}px)`,
  };
}

/**
 * Mola discreta para o único momento que merece física: o selo de
 * pagamento confirmado. `damping` alto de propósito — um check que
 * quica três vezes vira desenho animado.
 */
export function pop(frame: number, delaySeconds: number, fps: number): number {
  return spring({
    frame: frame - sec(delaySeconds),
    fps,
    config: { damping: 14, mass: 0.6, stiffness: 140 },
  });
}

/**
 * Fade de cena. As cenas se sobrepõem por alguns frames; isto evita o
 * flash de branco que um corte seco produziria entre dois fundos claros.
 */
export function sceneOpacity(
  frame: number,
  durationInFrames: number,
  fadeInSeconds = 0.35,
  fadeOutSeconds = 0.35,
): number {
  const fadeIn = sec(fadeInSeconds);
  const fadeOut = sec(fadeOutSeconds);

  // A cena de abertura entra com fadeIn 0 — ela precisa estar inteira no
  // frame 0 para servir de poster. `interpolate` exige um intervalo
  // estritamente crescente, então os trechos de duração zero são
  // montados fora do array em vez de virarem [0, 0, ...].
  const fadeInPart: [number[], number[]] = fadeIn > 0 ? [[0, fadeIn], [0, 1]] : [[0], [1]];
  const outStart = durationInFrames - fadeOut;
  const lastIn = fadeInPart[0][fadeInPart[0].length - 1] ?? 0;
  const fadeOutPart: [number[], number[]] =
    fadeOut > 0 && outStart > lastIn ? [[outStart, durationInFrames], [1, 0]] : [[], []];

  const input = [...fadeInPart[0], ...fadeOutPart[0]];
  const output = [...fadeInPart[1], ...fadeOutPart[1]];

  if (input.length < 2) return 1;

  return interpolate(frame, input, output, {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
}
