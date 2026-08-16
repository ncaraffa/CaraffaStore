import React from "react";
import { Composition } from "remotion";
import "./lib/fonts";
import { ProductFilm, TOTAL_FRAMES } from "./ProductFilm";
import { ProductFilmMobile } from "./ProductFilmMobile";
import { VIDEO } from "./lib/theme";

/**
 * Duas composições, uma história.
 *
 * `Desktop` e `Mobile` compartilham roteiro, dados, identidade e
 * relógio. O que não compartilham é enquadramento: a versão vertical
 * não é um corte da horizontal, e o motivo está medido em
 * components/MobileStage.
 */
export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="CaraffaStoreProductFilmDesktop"
      component={ProductFilm}
      durationInFrames={TOTAL_FRAMES}
      fps={VIDEO.fps}
      width={VIDEO.width}
      height={VIDEO.height}
    />
    <Composition
      id="CaraffaStoreProductFilmMobile"
      component={ProductFilmMobile}
      durationInFrames={TOTAL_FRAMES}
      fps={VIDEO.fps}
      width={1080}
      height={1350}
    />
  </>
);
