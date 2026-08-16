import React from "react";
import { AbsoluteFill, Sequence, useCurrentFrame } from "remotion";
import { Backdrop } from "./components/Backdrop";
import { sceneOpacity } from "./lib/timing";
import {
  M1Opening,
  M2Publish,
  M3Storefront,
  M4Checkout,
  M5PixConfirmed,
  M6Orders,
  M7Stock,
  M8Close,
} from "./scenes/mobile/MobileScenes";

/* ============================================================
   Timeline vertical

   Exatamente os mesmos limites de cena do 16:9 — 900 frames, 30 fps,
   30,0 s. As duas versões contam a mesma história no mesmo relógio; o
   que muda é o enquadramento de cada cena, não o ritmo.
   ============================================================ */

const OVERLAP = 12;

type SceneDef = { start: number; duration: number; Component: React.FC; fadeIn: number; fadeOut: number };

const SCENES: SceneDef[] = [
  { start: 0, duration: 96, Component: M1Opening, fadeIn: 0, fadeOut: 0.4 },
  { start: 96, duration: 132, Component: M2Publish, fadeIn: 0.32, fadeOut: 0.35 },
  { start: 228, duration: 144, Component: M3Storefront, fadeIn: 0.32, fadeOut: 0.35 },
  { start: 372, duration: 138, Component: M4Checkout, fadeIn: 0.32, fadeOut: 0.3 },
  { start: 510, duration: 96, Component: M5PixConfirmed, fadeIn: 0.14, fadeOut: 0.4 },
  { start: 606, duration: 120, Component: M6Orders, fadeIn: 0.34, fadeOut: 0.35 },
  { start: 726, duration: 90, Component: M7Stock, fadeIn: 0.32, fadeOut: 0.4 },
  { start: 816, duration: 84, Component: M8Close, fadeIn: 0.4, fadeOut: 0.5 },
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

export const ProductFilmMobile: React.FC = () => (
  <AbsoluteFill>
    <Backdrop />
    {SCENES.map(({ start, duration, Component, fadeIn, fadeOut }, i) => {
      const isLast = i === SCENES.length - 1;
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
