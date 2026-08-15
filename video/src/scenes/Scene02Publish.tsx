import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { color, font } from "../lib/theme";
import { EASE_OUT, progress, rise, sec } from "../lib/timing";
import { BrowserFrame } from "../components/Device";
import { ProductFormScreen } from "../components/DashboardScreens";
import { Cursor, cursorPath } from "../components/Pointer";
import { MonoLabel } from "../components/ui";

/**
 * Cena 2 — o lojista publica um produto.
 *
 * O formulário aparece já quase preenchido e os últimos campos se
 * completam sozinhos: mostrar alguém digitando campo por campo
 * transformaria o filme em tutorial, que é exatamente o que não se quer.
 * O que precisa ficar entendido é a AÇÃO — "eu coloco meus produtos
 * aqui" — e quem explica isso é o cursor indo até "Publicar".
 *
 * Os campos são os reais de `app/dashboard/products/product-form.tsx`:
 * nome, preço, categoria e estoque inicial. Nada inventado.
 */
export const Scene02Publish: React.FC = () => {
  const frame = useCurrentFrame();

  // Preenchimento: nome já pronto, preço e categoria digitando.
  const typed = interpolate(frame, [0, sec(0.9), sec(1.8)], [1, 2, 3], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const clickAt = 2.55;
  // Coordenadas locais da moldura (1240x800): o botão "Publicar produto"
  // fica na coluna da direita do formulário. Medido no render, não
  // estimado — a primeira versão deixava o cursor parado no vazio.
  const cursor = cursorPath(frame, { x: 880, y: 660 }, { x: 612, y: 566 }, 1.85, 0.65);
  const pressed = frame >= sec(clickAt) && frame < sec(clickAt + 0.14) ? 1 : 0;
  const published = frame >= sec(clickAt + 0.1);

  // A moldura recua levemente depois do clique — o "feito" ganha ar.
  const settle = progress(frame, clickAt + 0.15, 0.9, EASE_OUT);
  const scale = 1 - settle * 0.03;

  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <div style={{ position: "relative", ...rise(frame, 0, 0.55, 22) }}>
        <div style={{ transform: `scale(${scale})`, transformOrigin: "center" }}>
          <BrowserFrame url="caraffastore.com.br/dashboard/products/new" width={1240} height={800}>
            <ProductFormScreen typed={typed} pressed={pressed} published={published} />
          </BrowserFrame>

          <Cursor x={cursor.x} y={cursor.y} opacity={interpolate(frame, [sec(1.6), sec(1.85)], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          })} />
        </div>

        {/* Legenda de contexto: uma linha, em mono, fora da moldura.
            Não é narração — é o rótulo que diz de qual lado da história
            estamos. */}
        <div
          style={{
            position: "absolute",
            top: -46,
            left: 4,
            display: "flex",
            alignItems: "center",
            gap: 12,
            ...rise(frame, 0.1, 0.5, 10),
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: 999,
              background: color.blue600,
            }}
          />
          <MonoLabel size={14}>Você, no painel</MonoLabel>
        </div>
      </div>
    </AbsoluteFill>
  );
};
