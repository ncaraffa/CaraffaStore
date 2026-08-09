import type { Metadata } from "next";
import { Bricolage_Grotesque, Inter, JetBrains_Mono } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

/**
 * Três papéis tipográficos, nunca intercambiáveis:
 * - display: títulos e preços. Bricolage Grotesque carrega a
 *   personalidade da marca (grotesca de largura variável, com
 *   caráter próprio — não é a fonte de UI de todo mundo).
 * - sans: toda a interface. Inter é a escolha certa para densidade
 *   e legibilidade; a personalidade não é trabalho dela.
 * - mono: dado literal — código de pedido, chave Pix, credencial,
 *   rótulo de seção. Reforça que estes caracteres importam um a um.
 */
const display = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
  axes: ["opsz"],
});

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: {
    default: "CaraffaStore — Crie e administre sua loja virtual",
    template: "%s · CaraffaStore",
  },
  description: "CaraffaStore: catálogo, carrinho, pedidos e pagamentos Pix para pequenos comerciantes.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" className={[display.variable, inter.variable, mono.variable].join(" ")}>
      <body>{children}</body>
    </html>
  );
}
