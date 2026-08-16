import React from "react";
import { color, font, radius, shadow } from "../lib/theme";

/**
 * Moldura de navegador. Dá o contexto de "isto é uma página na internet,
 * com link só dela" sem precisar dizer isso em texto — mesma função que
 * a moldura tem na demonstração da landing.
 */
export const BrowserFrame: React.FC<{
  url: string;
  width: number;
  height: number;
  children: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ url, width, height, children, style }) => (
  <div
    style={{
      width,
      height,
      borderRadius: radius.xl,
      background: color.white,
      border: `1px solid ${color.line}`,
      boxShadow: shadow.device,
      overflow: "hidden",
      display: "flex",
      flexDirection: "column",
      ...style,
    }}
  >
    <div
      style={{
        height: 46,
        flex: "none",
        background: color.surface,
        borderBottom: `1px solid ${color.line}`,
        display: "flex",
        alignItems: "center",
        gap: 18,
        padding: "0 18px",
      }}
    >
      <div style={{ display: "flex", gap: 7 }}>
        {[0, 1, 2].map((i) => (
          <div key={i} style={{ width: 10, height: 10, borderRadius: 999, background: color.lineStrong }} />
        ))}
      </div>
      <div
        style={{
          flex: 1,
          height: 26,
          borderRadius: radius.full,
          background: color.white,
          border: `1px solid ${color.line}`,
          display: "flex",
          alignItems: "center",
          padding: "0 14px",
          fontFamily: font.mono,
          fontSize: 13,
          color: color.inkMuted,
        }}
      >
        {url}
      </div>
    </div>
    <div style={{ flex: 1, minHeight: 0, position: "relative", overflow: "hidden" }}>{children}</div>
  </div>
);

/**
 * Moldura de celular. Sem notch desenhado nem botões laterais: quanto
 * menos aparato, mais a tela do produto fica sendo o assunto.
 */
export const PhoneFrame: React.FC<{
  width: number;
  height: number;
  children: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ width, height, children, style }) => (
  <div
    style={{
      width,
      height,
      borderRadius: 46,
      padding: 12,
      background: color.white,
      border: `1px solid ${color.lineStrong}`,
      boxShadow: shadow.device,
      ...style,
    }}
  >
    <div
      style={{
        width: "100%",
        height: "100%",
        borderRadius: 35,
        overflow: "hidden",
        background: color.white,
        border: `1px solid ${color.line}`,
        position: "relative",
      }}
    >
      {children}
    </div>
  </div>
);
