import type { Metadata } from "next";
import { Bricolage_Grotesque, Inter, JetBrains_Mono } from "next/font/google";
import type { ReactNode } from "react";
import { getSiteUrl } from "@/lib/config/site";
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

const SITE_URL = getSiteUrl();
const DESCRIPTION =
  "Monte seu catálogo, compartilhe o link da sua loja e receba por Pix direto na sua conta do Mercado Pago. Mensalidade fixa a partir de R$ 30, sem comissão sobre as vendas.";

/**
 * `metadataBase` sai de NEXT_PUBLIC_SITE_URL (lib/config/site.ts) — a
 * mesma variável que o Supabase Auth já usa para os redirects. Apontar o
 * site para um domínio próprio é trocar essa variável: canonical,
 * OpenGraph e Twitter Card acompanham sozinhos, sem nenhum domínio
 * escrito à mão no código.
 */
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "CaraffaStore — Crie e administre sua loja virtual",
    template: "%s · CaraffaStore",
  },
  description: DESCRIPTION,
  applicationName: "CaraffaStore",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: "CaraffaStore",
    locale: "pt_BR",
    url: "/",
    title: "CaraffaStore — Crie e administre sua loja virtual",
    description: DESCRIPTION,
  },
  twitter: {
    card: "summary",
    title: "CaraffaStore — Crie e administre sua loja virtual",
    description: DESCRIPTION,
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" className={[display.variable, inter.variable, mono.variable].join(" ")}>
      <body>
        {/* Sem JS o scroll reveal nunca dispara — o conteúdo não pode ficar invisível. */}
        <noscript>
          <style>{`[data-reveal]{opacity:1!important;transform:none!important}`}</style>
        </noscript>
        {children}
      </body>
    </html>
  );
}
