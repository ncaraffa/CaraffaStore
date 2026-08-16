import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { color, font } from "../lib/theme";
import { EASE_OUT, progress, sec } from "../lib/timing";
import { BrowserFrame } from "../components/Device";
import { ProductFormScreen } from "../components/DashboardScreens";
import { Cursor, cursorPath } from "../components/Pointer";
import { CameraFrame, SceneLabel } from "../components/Stage";
import { CheckIcon } from "../components/ui";

/* Moldura menor que a versão anterior (700 no lugar de 800) porque a
   página sobrava embaixo, e a altura sobrando era altura desperdiçada:
   com 700 cabe escala maior dentro do mesmo quadro. */
const W = 1240;
const H = 700;

/** Botão "Publicar produto", em coordenadas locais da moldura. */
const PUBLISH_BUTTON = { x: 612, y: 556 };

/**
 * Cena 2 — o lojista publica um produto.
 *
 * O formulário aparece já quase preenchido e os últimos campos se
 * completam sozinhos: mostrar alguém digitando campo por campo
 * transformaria o filme em tutorial, que é exatamente o que não se
 * quer. O que precisa ficar entendido é a AÇÃO, e quem explica isso é
 * o cursor indo até "Publicar".
 *
 * A câmera fecha em 1,26. Na
 * versão anterior a moldura ocupava 65% da largura e o texto do
 * formulário media 8px num embed de 1100px — legível só em tela cheia.
 * Aqui o botão e o campo ficam grandes o bastante para a ação ser lida
 * mesmo com o vídeo pequeno dentro da página.
 */
export const Scene02Publish: React.FC = () => {
  const frame = useCurrentFrame();

  const typed = interpolate(frame, [0, sec(0.9), sec(1.7)], [1, 2, 3], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const clickAt = 2.5;
  const cursor = cursorPath(frame, { x: 900, y: 640 }, PUBLISH_BUTTON, 1.75, 0.65);
  const pressed = frame >= sec(clickAt) && frame < sec(clickAt + 0.14) ? 1 : 0;
  const published = frame >= sec(clickAt + 0.1);

  // Escala fixa em 1,26 (+26% de presença sobre a versão anterior).
  // O teto não é estético, é geométrico: com moldura de 700 e o rótulo
  // ancorado em y=46, a moldura precisa começar abaixo de y=96, o que
  // dá (1080 - 700*s)/2 >= 96, ou seja s <= 1,268. Acima disso o título
  // "Novo produto" saía cortado pelo topo e o rótulo caía sobre a
  // barra lateral — foi exatamente o que aconteceu na primeira
  // tentativa, com 1,45.
  const enter = progress(frame, 0, 0.6, EASE_OUT);
  const push = progress(frame, 1.7, 1.1, EASE_OUT);
  const scale = 1.26;

  // O deslocamento horizontal mira a coluna do formulário sem deixar a
  // moldura sangrar: 80px de folga de cada lado é o que sobra em 1,26.
  const focusX = interpolate(push, [0, 1], [W / 2 + 40, W / 2 + 80], { extrapolateRight: "clamp" });
  const focusY = H / 2;

  const confirm = progress(frame, clickAt + 0.12, 0.5, EASE_OUT);

  return (
    <AbsoluteFill>
      <CameraFrame
        width={W}
        height={H}
        scale={scale}
        focus={{ x: focusX, y: focusY }}
        style={{ opacity: enter, transform: `translateY(${(1 - enter) * 22}px)` }}
      >
        <BrowserFrame url="caraffastore.com.br/dashboard/products/new" width={W} height={H}>
          <ProductFormScreen typed={typed} pressed={pressed} published={published} />
        </BrowserFrame>
        <Cursor
          x={cursor.x}
          y={cursor.y}
          opacity={interpolate(frame, [sec(1.5), sec(1.75)], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          })}
        />
      </CameraFrame>

      <SceneLabel opacity={enter} transform={`translateY(${(1 - enter) * -8}px)`}>
        Você, no painel
      </SceneLabel>

      {/* Confirmação da ação, fora da interface: o produto entrou no
          catálogo. Discreta e curta — a interface já mostra o estado, o
          selo só garante que ninguém perca o acontecimento. */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 58,
          display: "flex",
          justifyContent: "center",
          opacity: confirm,
          transform: `translateY(${(1 - confirm) * 14}px)`,
        }}
      >
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 14,
            padding: "16px 28px",
            borderRadius: 999,
            background: color.white,
            border: `1px solid ${color.successBorder}`,
            boxShadow: "0 8px 16px -4px rgba(12, 27, 51, 0.07), 0 36px 80px -20px rgba(12, 27, 51, 0.22)",
          }}
        >
          <span
            style={{
              width: 30,
              height: 30,
              borderRadius: 999,
              background: color.success,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <CheckIcon size={17} strokeWidth={3} />
          </span>
          <span style={{ fontFamily: font.sans, fontSize: 22, fontWeight: 600, color: color.ink }}>
            Produto no ar
          </span>
        </div>
      </div>
    </AbsoluteFill>
  );
};
