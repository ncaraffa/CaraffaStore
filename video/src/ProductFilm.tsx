import React from "react";
import { AbsoluteFill, Sequence, useCurrentFrame } from "remotion";
import { Backdrop } from "./components/Backdrop";
import { sceneOpacity } from "./lib/timing";
import { Scene01Opening } from "./scenes/Scene01Opening";
import { Scene02Publish } from "./scenes/Scene02Publish";
import { Scene03Storefront } from "./scenes/Scene03Storefront";
import { Scene04Checkout } from "./scenes/Scene04Checkout";
import { Scene05PixConfirmed } from "./scenes/Scene05PixConfirmed";
import { Scene06Orders } from "./scenes/Scene06Orders";
import { Scene07Stock } from "./scenes/Scene07Stock";
import { Scene08Close } from "./scenes/Scene08Close";

/* ============================================================
   Timeline

   900 frames a 30 fps = 30,0 s exatos.

   Cada cena dura o próprio bloco MAIS 12 frames de sobra, e é durante
   essa sobra que ela desaparece enquanto a seguinte já está entrando.
   Sem essa sobreposição, os dois fundos brancos produziriam um flash
   entre cenas — o corte seco entre superfícies claras é o erro clássico
   deste tipo de filme.
   ============================================================ */

const OVERLAP = 12;

type SceneDef = { start: number; duration: number; Component: React.FC; fadeIn: number; fadeOut: number };

const SCENES: SceneDef[] = [
  { start: 0, duration: 96, Component: Scene01Opening, fadeIn: 0, fadeOut: 0.4 },
  { start: 96, duration: 132, Component: Scene02Publish, fadeIn: 0.32, fadeOut: 0.35 },
  { start: 228, duration: 144, Component: Scene03Storefront, fadeIn: 0.32, fadeOut: 0.35 },
  { start: 372, duration: 138, Component: Scene04Checkout, fadeIn: 0.32, fadeOut: 0.3 },
  // Cena 5 continua o MESMO aparelho da cena 4: entrada quase seca, para
  // não parecer que o telefone piscou entre uma e outra.
  { start: 510, duration: 96, Component: Scene05PixConfirmed, fadeIn: 0.14, fadeOut: 0.4 },
  { start: 606, duration: 120, Component: Scene06Orders, fadeIn: 0.34, fadeOut: 0.35 },
  { start: 726, duration: 90, Component: Scene07Stock, fadeIn: 0.32, fadeOut: 0.4 },
  { start: 816, duration: 84, Component: Scene08Close, fadeIn: 0.4, fadeOut: 0.5 },
];

const Fade: React.FC<{ durationInFrames: number; fadeIn: number; fadeOut: number; children: React.ReactNode }> = ({
  durationInFrames,
  fadeIn,
  fadeOut,
  children,
}) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ opacity: sceneOpacity(frame, durationInFrames, fadeIn, fadeOut) }}>
      {children}
    </AbsoluteFill>
  );
};

export const ProductFilm: React.FC = () => {
  return (
    <AbsoluteFill>
      {/* O fundo nunca troca. É ele que faz o corte entre cenas parecer
          troca de conteúdo, não troca de vídeo. */}
      <Backdrop />

      {SCENES.map(({ start, duration, Component, fadeIn, fadeOut }, i) => {
        const isLast = i === SCENES.length - 1;
        // A última cena não estende além do fim da composição.
        const total = isLast ? duration : duration + OVERLAP;
        return (
          <Sequence key={i} from={start} durationInFrames={total} layout="none">
            <Fade durationInFrames={total} fadeIn={fadeIn} fadeOut={fadeOut}>
              <Component />
            </Fade>
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};

export const TOTAL_FRAMES = 900;
