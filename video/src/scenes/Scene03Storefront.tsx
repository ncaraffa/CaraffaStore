import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { color } from "../lib/theme";
import { EASE_OUT, progress, rise, sec } from "../lib/timing";
import { BrowserFrame } from "../components/Device";
import { StorefrontCatalog } from "../components/StorefrontScreens";
import { Cursor, cursorPath } from "../components/Pointer";
import { MonoLabel } from "../components/ui";

/**
 * Cena 3 — a loja, do lado de quem compra.
 *
 * A mesma moldura de navegador da cena anterior, agora com a URL
 * pública: é a virada de ponto de vista, e ela é lida sem uma palavra —
 * mudou o endereço, mudou a interface, mudou quem está no comando.
 *
 * O catálogo é o real: grade de quatro colunas, chips de categoria com o
 * ativo em navy, card 1:1 com preço em tabular e o controle de
 * quantidade ao lado de "Adicionar". O produto publicado na cena 2 é o
 * primeiro da grade — a continuidade é o argumento.
 */
export const Scene03Storefront: React.FC = () => {
  const frame = useCurrentFrame();

  const clickAt = 2.5;
  // Botão "Adicionar" do primeiro card, em coordenadas da moldura
  // (1240x800). Com 720 de altura a linha do botão ficava CORTADA pelo
  // fim do quadro — o clique acontecia fora da tela.
  const cursor = cursorPath(frame, { x: 420, y: 720 }, { x: 200, y: 700 }, 1.5, 0.9);
  const pressed = frame >= sec(clickAt) && frame < sec(clickAt + 0.14) ? 1 : 0;
  const added = frame >= sec(clickAt + 0.1);

  // O card do produto sob o cursor ganha elevação quando o ponteiro chega.
  const hover = progress(frame, 2.25, 0.25, EASE_OUT);

  // O contador do carrinho vira 1 no clique.
  const cartCount = added ? 1 : 0;

  // Pan lentíssimo para a esquerda: dá vida sem chamar atenção para si.
  const pan = interpolate(frame, [0, sec(4.8)], [10, -10], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <div style={{ position: "relative", ...rise(frame, 0, 0.5, 20) }}>
        <div style={{ transform: `translateX(${pan}px)` }}>
          <BrowserFrame url="caraffastore.com.br/loja/casa-do-cafe" width={1240} height={800}>
            <StorefrontCatalog
              cartCount={cartCount}
              highlightIndex={0}
              highlight={hover}
              addedIndex={added ? 0 : null}
              pressed={pressed}
            />
          </BrowserFrame>

          <Cursor
            x={cursor.x}
            y={cursor.y}
            opacity={interpolate(frame, [sec(1.25), sec(1.5)], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            })}
          />
        </div>

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
          <span style={{ width: 8, height: 8, borderRadius: 999, background: color.success }} />
          <MonoLabel size={14}>Seu cliente, no link que você mandou</MonoLabel>
        </div>
      </div>
    </AbsoluteFill>
  );
};
