import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { color, font, radius, shadow } from "../lib/theme";
import { progress } from "../lib/timing";
import { ProductArt } from "../components/ProductArt";
import { CheckIcon, MonoLabel, PixIcon } from "../components/ui";

/**
 * Cena 1 — abertura.
 *
 * O frame 0 já é uma composição completa: manchete legível e peças de
 * interface no lugar. Nada de fade a partir do branco, porque este
 * frame também precisa funcionar como poster de um vídeo em autoplay —
 * se o navegador segurar o play, o que fica na tela ainda vende.
 *
 * A manchete quebra em DUAS LINHAS EXPLÍCITAS. Deixar o navegador
 * quebrar sozinho fazia o destaque azul atravessar a quebra e o
 * sublinhado de marca virar dois traços soltos, com cara de link.
 *
 * As três peças flutuantes têm posições calculadas para não se
 * encostarem: card à esquerda, selo de Pix à direita dele, selo de
 * estoque abaixo. Peça sobre peça em composição de abertura lê como
 * descuido, não como profundidade.
 */
/**
 * Assentamento da abertura.
 *
 * Diferente do helper compartilhado usado nas outras cenas, este NUNCA
 * começa em opacidade zero: no frame 0 a cena precisa estar inteira na
 * tela, porque é ela que serve de poster de um vídeo em autoplay. O
 * movimento é só um deslocamento de poucos pixels que termina de
 * assentar — elegante sem deixar o primeiro frame em branco.
 */
function settle(frame: number, delaySeconds: number, distance = 18) {
  const p = progress(frame, delaySeconds, 0.9);
  return { opacity: 1, transform: `translateY(${(1 - p) * distance}px)` };
}

export const Scene01Opening: React.FC = () => {
  const frame = useCurrentFrame();

  // Zoom lento e contínuo: 1.0 → 1.03 ao longo da cena.
  const breathe = 1 + progress(frame, 0, 3.2, (t) => t) * 0.03;

  return (
    <AbsoluteFill
      style={{
        alignItems: "center",
        justifyContent: "center",
        transform: `scale(${breathe})`,
      }}
    >
      <div style={{ width: 1320, display: "flex", alignItems: "center", gap: 60 }}>
        {/* Coluna de texto */}
        <div style={{ width: 660, flex: "none" }}>
          <div style={{ ...settle(frame, 0.0, 12), marginBottom: 24 }}>
            <MonoLabel size={15}>Loja virtual para pequenos comerciantes</MonoLabel>
          </div>

          <div
            style={{
              fontFamily: font.display,
              fontWeight: 700,
              fontSize: 74,
              lineHeight: 1.04,
              letterSpacing: "-0.03em",
              color: color.ink,
            }}
          >
            <div style={settle(frame, 0.06, 16)}>Do catálogo ao</div>
            <div style={{ color: color.blue600, ...settle(frame, 0.2, 16) }}>Pix na sua conta.</div>
          </div>

          <div
            style={{
              marginTop: 28,
              fontFamily: font.sans,
              fontSize: 25,
              lineHeight: 1.5,
              color: color.inkMuted,
              maxWidth: 540,
              ...settle(frame, 0.34, 14),
            }}
          >
            Sua loja online, pedidos e estoque em um só lugar.
          </div>
        </div>

        {/* Coluna de peças de interface — posições sem colisão */}
        <div style={{ width: 600, flex: "none", position: "relative", height: 540 }}>
          {/* Card de produto */}
          <div
            style={{
              position: "absolute",
              left: 40,
              top: 24,
              width: 250,
              background: color.white,
              border: `1px solid ${color.line}`,
              borderRadius: radius.lg,
              boxShadow: shadow.lg,
              padding: 14,
              ...settle(frame, 0.15, 30),
            }}
          >
            <div
              style={{
                aspectRatio: "1 / 1",
                borderRadius: radius.md,
                overflow: "hidden",
                marginBottom: 12,
              }}
            >
              <ProductArt kind="bag" uid="hero" />
            </div>
            <div style={{ fontFamily: font.sans, fontSize: 15, fontWeight: 600, color: color.ink }}>
              Café Especial 500 g
            </div>
            <div
              style={{
                marginTop: 6,
                fontFamily: font.sans,
                fontSize: 20,
                fontWeight: 700,
                color: color.ink,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              R$ 39,90
            </div>
          </div>

          {/* Chip: Pix confirmado — à direita do card, sem encostar */}
          <div
            style={{
              position: "absolute",
              left: 316,
              top: 196,
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "14px 20px",
              background: color.white,
              border: `1px solid ${color.successBorder}`,
              borderRadius: radius.lg,
              boxShadow: shadow.lg,
              whiteSpace: "nowrap",
              ...settle(frame, 0.42, 26),
            }}
          >
            <span
              style={{
                width: 32,
                height: 32,
                borderRadius: 999,
                background: color.success,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flex: "none",
              }}
            >
              <CheckIcon size={17} strokeWidth={3} />
            </span>
            <span style={{ display: "flex", flexDirection: "column" }}>
              <span style={{ fontFamily: font.sans, fontSize: 15, fontWeight: 700, color: color.ink }}>
                Pix confirmado
              </span>
              <span style={{ fontFamily: font.mono, fontSize: 13, color: color.inkMuted }}>Pedido #1042</span>
            </span>
          </div>

          {/* Chip: estoque — abaixo do card */}
          <div
            style={{
              position: "absolute",
              left: 96,
              top: 458,
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "12px 18px",
              background: color.white,
              border: `1px solid ${color.line}`,
              borderRadius: radius.lg,
              boxShadow: shadow.md,
              whiteSpace: "nowrap",
              ...settle(frame, 0.58, 22),
            }}
          >
            <PixIcon size={18} />
            <span style={{ fontFamily: font.sans, fontSize: 15, color: color.inkBody }}>Estoque atualizado</span>
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
