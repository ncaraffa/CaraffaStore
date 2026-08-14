import type { Metadata } from "next";
import type { ReactNode } from "react";

/**
 * A página desta rota é um Client Component e por isso não pode exportar
 * `metadata`. Este layout existe só para dar título próprio à aba — sem
 * ele, todas as telas de conta herdavam o título da home.
 */
export const metadata: Metadata = {
  title: "Criar conta",
  description: "Crie sua conta na CaraffaStore e monte a loja virtual do seu negócio.",
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
