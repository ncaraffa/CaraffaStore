import React from "react";
import { color, font, radius, shadow } from "../lib/theme";

/**
 * Primitivas de UI reproduzidas do produto.
 *
 * Cada uma existe de verdade em `components/ui/*` — Badge, Button, Card,
 * Field — e os valores aqui (peso, raio, tom, altura) foram lidos de lá.
 * São reproduções visuais, não imports: o vídeo não pode acoplar o build
 * da aplicação à sua toolchain.
 */

export type Tone = "success" | "warning" | "info" | "neutral" | "danger";

const TONE: Record<Tone, { bg: string; fg: string; border: string }> = {
  success: { bg: color.successBg, fg: color.successText, border: color.successBorder },
  warning: { bg: color.warningBg, fg: color.warningText, border: color.warningBorder },
  info: { bg: color.blue50, fg: color.blue700, border: color.blue100 },
  neutral: { bg: color.neutralBg, fg: color.neutralText, border: color.line },
  danger: { bg: "#fef2f2", fg: "#b3181d", border: "#fecaca" },
};

export const Badge: React.FC<{ tone?: Tone; children: React.ReactNode; size?: number }> = ({
  tone = "neutral",
  children,
  size = 13,
}) => {
  const t = TONE[tone];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: `${size * 0.28}px ${size * 0.7}px`,
        borderRadius: radius.full,
        background: t.bg,
        color: t.fg,
        border: `1px solid ${t.border}`,
        fontFamily: font.sans,
        fontSize: size,
        fontWeight: 600,
        whiteSpace: "nowrap",
        lineHeight: 1,
      }}
    >
      {children}
    </span>
  );
};

export const PrimaryButton: React.FC<{
  children: React.ReactNode;
  width?: number | string;
  height?: number;
  fontSize?: number;
  pressed?: number;
}> = ({ children, width = "100%", height = 46, fontSize = 15, pressed = 0 }) => (
  <div
    style={{
      width,
      height,
      borderRadius: radius.md,
      background: `linear-gradient(180deg, ${color.blue500}, ${color.blue600})`,
      color: color.white,
      fontFamily: font.sans,
      fontWeight: 600,
      fontSize,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      boxShadow: shadow.glowBlue,
      // O botão afunda 1px ao ser pressionado — a mesma resposta física
      // do `.btn:active` do site.
      transform: `translateY(${pressed}px)`,
    }}
  >
    {children}
  </div>
);

export const Card: React.FC<{
  children: React.ReactNode;
  style?: React.CSSProperties;
  padding?: number;
}> = ({ children, style, padding = 20 }) => (
  <div
    style={{
      background: color.white,
      border: `1px solid ${color.line}`,
      borderRadius: radius.lg,
      boxShadow: `${shadow.sm}, ${shadow.sheen}`,
      padding,
      ...style,
    }}
  >
    {children}
  </div>
);

/** Rótulo de seção em mono maiúsculo — o `.cs-label` do site. */
export const MonoLabel: React.FC<{ children: React.ReactNode; size?: number; tone?: string }> = ({
  children,
  size = 12,
  tone = color.inkMuted,
}) => (
  <span
    style={{
      fontFamily: font.mono,
      fontSize: size,
      fontWeight: 500,
      letterSpacing: "0.12em",
      textTransform: "uppercase",
      color: tone,
    }}
  >
    {children}
  </span>
);

/** Campo de formulário no estado "preenchido" — reprodução do `Field`. */
export const FilledField: React.FC<{
  label: string;
  value: string;
  width?: number | string;
  caret?: boolean;
}> = ({ label, value, width = "100%", caret = false }) => (
  <div style={{ width, display: "flex", flexDirection: "column", gap: 6 }}>
    <span style={{ fontFamily: font.sans, fontSize: 13, fontWeight: 600, color: color.ink }}>{label}</span>
    <div
      style={{
        height: 42,
        borderRadius: radius.md,
        border: `1px solid ${caret ? color.blue600 : color.lineStrong}`,
        boxShadow: caret ? "0 0 0 3px rgba(27, 77, 255, 0.2)" : "none",
        background: color.white,
        display: "flex",
        alignItems: "center",
        padding: "0 12px",
        fontFamily: font.sans,
        fontSize: 14,
        color: color.inkBody,
        gap: 1,
      }}
    >
      <span>{value}</span>
      {caret && <span style={{ width: 1.5, height: 18, background: color.blue600 }} />}
    </div>
  </div>
);

export const CheckIcon: React.FC<{ size?: number; color?: string; strokeWidth?: number }> = ({
  size = 20,
  color: stroke = "#ffffff",
  strokeWidth = 2.6,
}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <path d="m5 13 4 4L19 7" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const PixIcon: React.FC<{ size?: number; fill?: string }> = ({ size = 20, fill = color.blue600 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <path
      d="M12 2.4 21.6 12 12 21.6 2.4 12 12 2.4Zm0 3.4L5.8 12 12 18.2 18.2 12 12 5.8Z"
      fill={fill}
    />
  </svg>
);

export const CartIcon: React.FC<{ size?: number; stroke?: string }> = ({ size = 20, stroke = color.inkBody }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <path
      d="M3 4h2l2.4 11.2a1.6 1.6 0 0 0 1.6 1.3h8.4a1.6 1.6 0 0 0 1.6-1.3L21 8H6"
      stroke={stroke}
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <circle cx="10" cy="20" r="1.4" fill={stroke} />
    <circle cx="18" cy="20" r="1.4" fill={stroke} />
  </svg>
);
