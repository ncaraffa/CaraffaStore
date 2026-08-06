import type { Metadata } from "next";
import { Inter } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: {
    default: "CaraffaStore — Crie e administre sua loja virtual",
    template: "%s · CaraffaStore",
  },
  description: "CaraffaStore: catálogo, carrinho, pedidos e pagamentos Pix para pequenos comerciantes.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
