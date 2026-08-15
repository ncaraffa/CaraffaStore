import React from "react";
import { AbsoluteFill } from "remotion";
import { color } from "../lib/theme";

/**
 * Fundo do filme inteiro.
 *
 * Mesma atmosfera do hero do site: branco dominante com duas fontes de
 * luz azul difusa, uma quente à esquerda e uma fria à direita. É o que
 * impede a tela branca de parecer chapada sem recorrer a gradiente
 * colorido, partícula ou blob — nada disso pertence a esta marca.
 *
 * O fundo NÃO se move entre cenas: é a constante que faz o corte entre
 * cenas parecer troca de conteúdo, não troca de vídeo.
 */
export const Backdrop: React.FC<{ tint?: number }> = ({ tint = 1 }) => {
  return (
    <AbsoluteFill style={{ backgroundColor: color.white }}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(1100px 720px at 18% 8%, rgba(27, 77, 255, ${0.075 * tint}), transparent 62%)`,
        }}
      />
      <AbsoluteFill
        style={{
          background: `radial-gradient(980px 680px at 88% 92%, rgba(46, 107, 255, ${0.06 * tint}), transparent 60%)`,
        }}
      />
      {/* Piso muito sutil: dá horizonte para as peças "assentarem". */}
      <AbsoluteFill
        style={{
          background: `linear-gradient(180deg, transparent 62%, rgba(12, 27, 51, 0.022) 100%)`,
        }}
      />
    </AbsoluteFill>
  );
};
