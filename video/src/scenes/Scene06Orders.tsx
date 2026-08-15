import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { color } from "../lib/theme";
import { EASE_OUT, progress, rise } from "../lib/timing";
import { BrowserFrame } from "../components/Device";
import { OrdersScreen } from "../components/DashboardScreens";
import { MonoLabel } from "../components/ui";

/**
 * Cena 6 — o pedido chega no painel.
 *
 * Corte imediato de volta para o navegador do lojista. A força desta
 * cena está no encadeamento com a anterior: o cliente pagou há dois
 * segundos e a linha já está aqui, com o mesmo código (#1042), o mesmo
 * valor e o mesmo nome. Nada é dito; a repetição dos dados é o
 * argumento.
 *
 * A linha entra empurrando as demais para baixo, com um realce azul que
 * some — o mesmo comportamento de "item novo" que qualquer painel usa,
 * porque é o que o olho já sabe ler.
 */
export const Scene06Orders: React.FC = () => {
  const frame = useCurrentFrame();

  const newOrder = progress(frame, 0.75, 0.6, EASE_OUT);
  // O aviso entra logo depois da linha e sai antes do fim da cena, para
  // não ficar pendurado sobre o conteúdo.
  const toastIn = progress(frame, 0.95, 0.4);
  const toastOut = 1 - progress(frame, 2.9, 0.4);
  const toast = Math.min(toastIn, toastOut);

  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <div style={{ position: "relative", ...rise(frame, 0, 0.5, 20) }}>
        <BrowserFrame url="caraffastore.com.br/dashboard/orders" width={1240} height={800}>
          <OrdersScreen newOrder={newOrder} toast={toast} />
        </BrowserFrame>

        <div
          style={{
            position: "absolute",
            top: -46,
            left: 4,
            display: "flex",
            alignItems: "center",
            gap: 12,
            ...rise(frame, 0.05, 0.5, 10),
          }}
        >
          <span style={{ width: 8, height: 8, borderRadius: 999, background: color.blue600 }} />
          <MonoLabel size={14}>De volta ao seu painel, na hora</MonoLabel>
        </div>
      </div>
    </AbsoluteFill>
  );
};
