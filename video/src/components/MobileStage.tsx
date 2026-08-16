import React from "react";
import { AbsoluteFill } from "remotion";
import { color, font, radius, shadow } from "../lib/theme";

/* ============================================================
   Palco do filme vertical

   A régua que define TODA a versão mobile:

   Um celular de 390px exibindo um vídeo de 1080px de largura reduz
   tudo por 0,361. Para um texto sair com pelo menos ~12px na tela do
   usuário, ele precisa medir ~33px dentro da composição. A interface
   real usa 14px. Logo, o fator mínimo é ~2,4.

   `MOBILE_SCALE = 2.4` sobre uma base de 416px fecha em 998px de
   largura. É por isso que a versão mobile NÃO é um corte do 16:9: no
   corte, a interface continuaria em 14px e ninguém leria nada. Aqui
   as telas são montadas na largura de um celular real — o mesmo
   layout de uma coluna que a aplicação já serve nesse breakpoint — e
   depois ampliadas em bloco.
   ============================================================ */

export const BASE_W = 416;
export const MOBILE_SCALE = 2.4;
/** Altura útil em px de CSS. */
export const BASE_H = 450;

/*
 * 416 x 450 a 2,4 dá 998 x 1080 dentro de um quadro de 1080 x 1350.
 * Sobram 135px em cima e embaixo: é a faixa onde vivem o rótulo da
 * cena e o selo de anotação. Sem essa faixa eles caíam DENTRO da
 * interface — foi o que aconteceu na primeira montagem, com o rótulo
 * "VOCÊ, NO PAINEL" por cima da barra do painel.
 */

/**
 * Superfície de tela: o conteúdo é montado em coordenadas de celular e
 * ampliado em bloco, então as proporções continuam sendo exatamente as
 * do produto — nada de fonte "aumentada para o vídeo".
 */
export const MobileScreen: React.FC<{
  children: React.ReactNode;
  /**
   * Cabeçalho que não acompanha a rolagem. A loja pública e o painel
   * têm header `position: sticky` de verdade; sem reproduzir isso, a
   * rolagem levava embora o nome da loja e a cena perdia justamente o
   * contexto de "isto é uma loja".
   */
  header?: React.ReactNode;
  /** Deslocamento vertical em px de CSS, para simular rolagem. */
  scrollY?: number;
  opacity?: number;
  lift?: number;
}> = ({ children, header, scrollY = 0, opacity = 1, lift = 0 }) => (
  <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
    <div
      style={{
        width: BASE_W,
        height: BASE_H,
        flex: "none",
        transform: `scale(${MOBILE_SCALE}) translateY(${lift}px)`,
        transformOrigin: "center center",
        opacity,
        borderRadius: 18,
        overflow: "hidden",
        background: color.white,
        border: `1px solid ${color.line}`,
        boxShadow: shadow.device,
        position: "relative",
      }}
    >
      {header && <div style={{ position: "relative", zIndex: 2 }}>{header}</div>}
      <div style={{ transform: `translateY(${-scrollY}px)` }}>{children}</div>
    </div>
  </AbsoluteFill>
);

/**
 * Bloco de texto do filme vertical — usado nas cenas de abertura e
 * fechamento, que não são interface e por isso não passam pela régua de
 * escala acima.
 */
export const MobileTextStage: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", padding: "0 80px" }}>
    <div style={{ width: "100%" }}>{children}</div>
  </AbsoluteFill>
);

/** Rótulo de cena da versão vertical: maior, e sempre no topo do quadro. */
export const MobileLabel: React.FC<{
  children: React.ReactNode;
  tone?: string;
  opacity?: number;
  transform?: string;
}> = ({ children, tone = color.blue600, opacity = 1, transform }) => (
  <div
    style={{
      position: "absolute",
      top: 54,
      left: 0,
      right: 0,
      display: "flex",
      justifyContent: "center",
      alignItems: "center",
      gap: 14,
      opacity,
      transform,
    }}
  >
    <span style={{ width: 12, height: 12, borderRadius: 999, background: tone, flex: "none" }} />
    <span
      style={{
        fontFamily: font.mono,
        fontSize: 26,
        fontWeight: 500,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        color: color.inkMuted,
      }}
    >
      {children}
    </span>
  </div>
);

/** Selo de anotação do filme vertical, ancorado ao pé do quadro. */
export const MobileCallout: React.FC<{
  children: React.ReactNode;
  opacity?: number;
  transform?: string;
  tone?: "blue" | "green";
}> = ({ children, opacity = 1, transform, tone = "blue" }) => (
  <div
    style={{
      position: "absolute",
      left: 0,
      right: 0,
      bottom: 34,
      display: "flex",
      justifyContent: "center",
      opacity,
      transform,
    }}
  >
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 16,
        padding: "20px 34px",
        borderRadius: radius.full,
        background: color.white,
        border: `1px solid ${tone === "blue" ? color.blue200 : color.successBorder}`,
        boxShadow: shadow.xl,
        fontFamily: font.sans,
        fontSize: 30,
        fontWeight: 500,
        color: color.inkBody,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </div>
  </div>
);
