import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { color } from "../lib/theme";
import { EASE_OUT, progress, sec } from "../lib/timing";
import { BrowserFrame } from "../components/Device";
import { StorefrontCatalog } from "../components/StorefrontScreens";
import { Cursor, cursorPath } from "../components/Pointer";
import { CameraFrame, SceneLabel } from "../components/Stage";

const W = 1240;
const H = 800;

/** Botão "Adicionar" do primeiro card, em coordenadas da moldura. */
const ADD_BUTTON = { x: 200, y: 700 };

/**
 * Cena 3 — a loja, do lado de quem compra.
 *
 * A mesma moldura de navegador da cena anterior, agora com a URL
 * pública: é a virada de ponto de vista, e ela é lida sem uma palavra —
 * mudou o endereco, mudou a interface, mudou quem esta no comando.
 *
 * O catálogo é o real: grade de quatro colunas, chips de categoria com
 * o ativo em navy, card 1:1 com preço em tabular e o controle de
 * quantidade ao lado de "Adicionar". O produto publicado na cena 2 é o
 * primeiro da grade — a continuidade é o argumento.
 *
 * A escala sobe só 8%: aqui a legibilidade já estava boa e os quatro
 * cards precisam continuar inteiros no quadro. Aumentar mais cortaria
 * a grade, que é justamente o que a cena tem de melhor.
 */
export const Scene03Storefront: React.FC = () => {
  const frame = useCurrentFrame();

  const enter = progress(frame, 0, 0.5, EASE_OUT);

  const clickAt = 2.5;
  const cursor = cursorPath(frame, { x: 420, y: 720 }, ADD_BUTTON, 1.5, 0.9);
  const pressed = frame >= sec(clickAt) && frame < sec(clickAt + 0.14) ? 1 : 0;
  const added = frame >= sec(clickAt + 0.1);

  const hover = progress(frame, 2.25, 0.25, EASE_OUT);
  const cartCount = added ? 1 : 0;

  // Deriva lenta em direção ao card clicado: vida sem chamar atenção.
  const drift = interpolate(frame, [0, sec(4.8)], [0, -34], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill>
      <CameraFrame
        width={W}
        height={H}
        scale={1.08}
        focus={{ x: W / 2 + drift, y: H / 2 + 10 }}
        style={{ opacity: enter, transform: `translateY(${(1 - enter) * 18}px)` }}
      >
        <BrowserFrame url="caraffastore.com.br/loja/casa-do-cafe" width={W} height={H}>
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
      </CameraFrame>

      <SceneLabel tone={color.success} opacity={enter} transform={`translateY(${(1 - enter) * -8}px)`}>
        Seu cliente, no link que você mandou
      </SceneLabel>
    </AbsoluteFill>
  );
};
