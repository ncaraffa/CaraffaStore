import React from "react";
import { color, font, radius, shadow } from "../lib/theme";

/**
 * Símbolo da marca — a jarra ("caraffa") cortada pela linha de nível.
 *
 * Path idêntico ao de `components/ui/Logo.tsx` no projeto, incluindo o
 * `fillRule: evenodd` que abre o vazado da linha sem `clipPath` (nada de
 * id duplicado quando a marca aparece mais de uma vez na composição).
 */
export const CaraffaMark: React.FC<{ size?: number; fill?: string }> = ({
  size = 24,
  fill = color.blue600,
}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <rect x="8.7" y="2.4" width="6.6" height="2.9" rx="1.45" fill={fill} />
    <path
      fill={fill}
      fillRule="evenodd"
      clipRule="evenodd"
      d="M9.6 5.1h4.8v3.1c0 1.05.45 2.05 1.24 2.74l2.16 1.96c1.14 1 1.8 2.45 1.8 3.97v.53a3.2 3.2 0 0 1-3.2 3.2H7.6a3.2 3.2 0 0 1-3.2-3.2v-.53c0-1.52.66-2.97 1.8-3.97l2.16-1.96C9.15 10.25 9.6 9.25 9.6 8.2V5.1ZM5.9 13.6h12.2v1.5H5.9v-1.5Z"
    />
  </svg>
);

/** Marca completa: selo cobalto + palavra, igual ao header do site. */
export const Logo: React.FC<{ scale?: number; inverse?: boolean }> = ({
  scale = 1,
  inverse = false,
}) => (
  <div style={{ display: "flex", alignItems: "center", gap: 12 * scale }}>
    <div
      style={{
        width: 44 * scale,
        height: 44 * scale,
        borderRadius: radius.md * scale,
        background: `linear-gradient(160deg, ${color.blue500}, ${color.blue700})`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: shadow.glowBlue,
      }}
    >
      <CaraffaMark size={26 * scale} fill="#ffffff" />
    </div>
    <span
      style={{
        fontFamily: font.display,
        fontWeight: 700,
        fontSize: 26 * scale,
        letterSpacing: "-0.03em",
        color: inverse ? color.white : color.ink,
      }}
    >
      CaraffaStore
    </span>
  </div>
);
