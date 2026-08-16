import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { EASE_OUT, progress } from "../lib/timing";
import { BrowserFrame } from "../components/Device";
import { OrdersScreen } from "../components/DashboardScreens";
import { CameraFrame, SceneLabel } from "../components/Stage";

const W = 1240;
const H = 700;

/** Centro da tabela de pedidos, em coordenadas locais da moldura. */
const TABLE_FOCUS = { x: 730, y: 400 };

/**
 * Cena 6 — o pedido chega no painel.
 *
 * Corte imediato de volta para o navegador do lojista. A força da cena
 * está no encadeamento com a anterior: o cliente pagou há dois segundos
 * e a linha já está aqui, com o mesmo código, o mesmo valor e o mesmo
 * nome. Nada é dito; a repetição dos dados é o argumento.
 *
 * O que mudou nesta passada: a câmera para de mostrar o painel inteiro
 * e enquadra a TABELA. Antes o espectador precisava procurar a linha
 * nova no meio da tela; agora ela ocupa o centro do quadro, e o realce
 * temporário (fundo azul-claro, faixa de destaque à esquerda) apaga
 * sozinho em cerca de um segundo, como faz qualquer painel que acabou
 * de receber um item.
 */
export const Scene06Orders: React.FC = () => {
  const frame = useCurrentFrame();

  const enter = progress(frame, 0, 0.5, EASE_OUT);

  const newOrder = progress(frame, 0.7, 0.55, EASE_OUT);
  // O realce vive ~1s e apaga: destaque que não some vira decoração.
  const highlight = 1 - progress(frame, 1.5, 0.9, EASE_OUT);

  const toastIn = progress(frame, 0.85, 0.35);
  const toastOut = 1 - progress(frame, 2.8, 0.4);
  const toast = Math.min(toastIn, toastOut);

  // Mesmo teto geométrico da cena 2 (ver comentário lá): 1,26 é o
  // máximo que mantém a moldura inteira com o rótulo ancorado no topo.
  const push = progress(frame, 0.2, 3.2, EASE_OUT);
  const scale = 1.26;

  return (
    <AbsoluteFill>
      <CameraFrame
        width={W}
        height={H}
        scale={scale}
        focus={{
          x: interpolate(push, [0, 1], [W / 2 + 50, W / 2 + 80], { extrapolateRight: "clamp" }),
          y: H / 2,
        }}
        style={{ opacity: enter, transform: `translateY(${(1 - enter) * 18}px)` }}
      >
        <BrowserFrame url="caraffastore.com.br/dashboard/orders" width={W} height={H}>
          <OrdersScreen newOrder={newOrder} toast={toast} highlight={Math.max(0, highlight)} />
        </BrowserFrame>
      </CameraFrame>

      <SceneLabel opacity={enter} transform={`translateY(${(1 - enter) * -8}px)`}>
        De volta ao seu painel, na hora
      </SceneLabel>
    </AbsoluteFill>
  );
};
