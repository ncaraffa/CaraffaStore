import React from "react";
import { Composition } from "remotion";
import "./lib/fonts";
import { ProductFilm, TOTAL_FRAMES } from "./ProductFilm";
import { VIDEO } from "./lib/theme";

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="ProductFilm"
      component={ProductFilm}
      durationInFrames={TOTAL_FRAMES}
      fps={VIDEO.fps}
      width={VIDEO.width}
      height={VIDEO.height}
    />
  );
};
