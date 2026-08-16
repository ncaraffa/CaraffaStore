/**
 * Tokens do product film.
 *
 * Cópia deliberada de `app/globals.css` — não um import. O vídeo é um
 * projeto separado, com seu próprio `package.json`, e acoplar a
 * aplicação à toolchain de vídeo (ou vice-versa) faria o build de
 * produção depender do Remotion. Quando a marca mudar, este arquivo é o
 * único ponto a atualizar aqui.
 *
 * Os valores abaixo são os mesmos do site, verificados na fonte.
 */

export const color = {
  blue50: "#f0f5ff",
  blue100: "#dee9ff",
  blue200: "#c2d6ff",
  blue300: "#94b6ff",
  blue400: "#5c8dff",
  blue500: "#2e6bff",
  blue600: "#1b4dff",
  blue700: "#143bd1",
  blue800: "#122fa0",
  blue900: "#142a72",
  blue950: "#0c1b33",

  ink: "#0c1b33",
  inkBody: "#33425c",
  inkMuted: "#64728e",
  inkFaint: "#8a97b2",

  white: "#ffffff",
  surface: "#f7f9fd",
  surfaceSunken: "#eff3fa",
  surfaceBlue: "#f4f7ff",
  line: "#e4eaf4",
  lineStrong: "#cfd9ea",

  success: "#0e9f6e",
  successBg: "#ecfdf5",
  successText: "#06603f",
  successBorder: "#a7f3d0",
  warning: "#d97706",
  warningBg: "#fffbeb",
  warningText: "#92400e",
  warningBorder: "#fde68a",
  neutralBg: "#eff3fa",
  neutralText: "#4a5a78",
} as const;

export const radius = {
  xs: 4,
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  xxl: 28,
  full: 999,
} as const;

/** Sombras azuladas (12,27,51), nunca pretas — mesma regra do site. */
export const shadow = {
  xs: "0 1px 2px rgba(12, 27, 51, 0.05)",
  sm: "0 1px 2px rgba(12, 27, 51, 0.06), 0 2px 6px -1px rgba(12, 27, 51, 0.05)",
  md: "0 2px 4px -1px rgba(12, 27, 51, 0.05), 0 8px 20px -6px rgba(12, 27, 51, 0.1)",
  lg: "0 4px 8px -2px rgba(12, 27, 51, 0.06), 0 20px 44px -12px rgba(12, 27, 51, 0.16)",
  xl: "0 8px 16px -4px rgba(12, 27, 51, 0.07), 0 36px 80px -20px rgba(12, 27, 51, 0.22)",
  device: "0 30px 70px -30px rgba(12, 27, 51, 0.42), 0 8px 20px -10px rgba(12, 27, 51, 0.18)",
  sheen: "inset 0 1px 0 rgba(255, 255, 255, 0.75)",
  glowBlue: "0 10px 28px -10px rgba(27, 77, 255, 0.45)",
} as const;

/**
 * Três papéis tipográficos, os mesmos do site: display para títulos e
 * preços, sans para UI, mono para dado literal (código de pedido, chave
 * Pix, rótulo de seção).
 */
export const font = {
  display: '"Bricolage Grotesque", "Segoe UI", system-ui, sans-serif',
  sans: '"Inter", -apple-system, "Segoe UI", Roboto, sans-serif',
  mono: '"JetBrains Mono", ui-monospace, "SFMono-Regular", monospace',
} as const;

export const VIDEO = {
  width: 1920,
  height: 1080,
  fps: 30,
} as const;

/**
 * Safe area central: tudo que carrega significado vive aqui dentro, para
 * um corte 1:1 ou 9:16 futuro não decapitar a composição.
 */
export const SAFE = {
  x: 300,
  y: 90,
  width: 1320,
  height: 900,
} as const;
