import type { ReactNode } from "react";

export default function StoreLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <footer style={{ marginTop: "2rem", padding: "1rem", fontSize: "0.85rem", textAlign: "center" }}>
        <a href="/termos">Termos de Uso</a> · <a href="/privacidade">Política de Privacidade</a>
      </footer>
    </>
  );
}
