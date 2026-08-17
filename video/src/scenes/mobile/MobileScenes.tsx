import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { color, font, radius, shadow } from "../../lib/theme";
import { EASE_OUT, pop, progress, sec } from "../../lib/timing";
import { ProductArt } from "../../components/ProductArt";
import { CheckIcon, MonoLabel, PrimaryButton } from "../../components/ui";
import { Logo } from "../../components/Brand";
import { CheckoutScreen, PixScreen } from "../../components/StorefrontScreens";
import {
  OrdersMobile,
  ProductFormMobile,
  StockMobile,
  StorefrontMobile,
  StorefrontMobileHeader,
} from "../../components/MobileScreens";
import { MobileCallout, MobileLabel, MobileScreen, MobileTextStage } from "../../components/MobileStage";
import { TouchRing } from "../../components/Pointer";

/* ============================================================
   Cenas do filme vertical (1080x1350)

   Mesma história, mesmos dados, mesmos acontecimentos e o mesmo
   relógio do 16:9 — o que muda é o enquadramento. Cada cena foi
   recomposta para a tela estreita, nunca recortada do horizontal:
   no corte, a interface continuaria em 14px e nada seria legível a
   390px de largura (ver a régua em components/MobileStage).
   ============================================================ */

/** Assentamento que nunca parte de opacidade zero — ver cena 1 do 16:9. */
function settle(frame: number, delaySeconds: number, distance = 22) {
  const p = progress(frame, delaySeconds, 0.9);
  return { opacity: 1, transform: `translateY(${(1 - p) * distance}px)` };
}

function rise(frame: number, delaySeconds: number, distance = 24) {
  const p = progress(frame, delaySeconds, 0.6);
  return { opacity: p, transform: `translateY(${(1 - p) * distance}px)` };
}

/* ===================== 1 — abertura ===================== */

export const M1Opening: React.FC = () => {
  const frame = useCurrentFrame();
  const breathe = 1 + progress(frame, 0, 3.2, (t) => t) * 0.03;

  return (
    <AbsoluteFill style={{ transform: `scale(${breathe})` }}>
      <MobileTextStage>
        <div style={{ ...settle(frame, 0, 14), marginBottom: 30 }}>
          <MonoLabel size={24}>Loja virtual para pequenos comerciantes</MonoLabel>
        </div>

        {/* Empilhada e em três linhas explícitas: no vertical a manchete
            é o elemento dominante, e a quebra não pode ficar por conta
            da largura do quadro. */}
        <div
          style={{
            fontFamily: font.display,
            fontWeight: 700,
            fontSize: 92,
            lineHeight: 1.03,
            letterSpacing: "-0.03em",
            color: color.ink,
          }}
        >
          <div style={settle(frame, 0.06, 18)}>Do catálogo</div>
          <div style={settle(frame, 0.16, 18)}>ao</div>
          <div style={{ color: color.blue600, ...settle(frame, 0.26, 18) }}>Pix na sua conta.</div>
        </div>

        <div
          style={{
            marginTop: 34,
            fontFamily: font.sans,
            fontSize: 34,
            lineHeight: 1.45,
            color: color.inkMuted,
            ...settle(frame, 0.4, 16),
          }}
        >
          Sua loja online, pedidos e estoque em um só lugar.
        </div>

        {/* Card e selo empilhados — no vertical eles vivem abaixo do
            texto, não ao lado. */}
        <div style={{ display: "flex", alignItems: "flex-end", gap: 24, marginTop: 56 }}>
          <div
            style={{
              width: 290,
              flex: "none",
              background: color.white,
              border: `1px solid ${color.line}`,
              borderRadius: radius.xl,
              boxShadow: shadow.lg,
              padding: 16,
              ...settle(frame, 0.2, 34),
            }}
          >
            <div style={{ aspectRatio: "1 / 1", borderRadius: radius.lg, overflow: "hidden", marginBottom: 14 }}>
              <ProductArt kind="bag" uid="mhero" />
            </div>
            <div style={{ fontFamily: font.sans, fontSize: 20, fontWeight: 600, color: color.ink }}>
              Café Especial 500 g
            </div>
            <div
              style={{
                marginTop: 6,
                fontFamily: font.sans,
                fontSize: 27,
                fontWeight: 700,
                color: color.ink,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              R$ 39,90
            </div>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              padding: "18px 24px",
              background: color.white,
              border: `1px solid ${color.successBorder}`,
              borderRadius: radius.xl,
              boxShadow: shadow.lg,
              marginBottom: 26,
              ...settle(frame, 0.5, 28),
            }}
          >
            <span
              style={{
                width: 40,
                height: 40,
                borderRadius: 999,
                background: color.success,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flex: "none",
              }}
            >
              <CheckIcon size={22} strokeWidth={3} />
            </span>
            <span style={{ display: "flex", flexDirection: "column" }}>
              <span style={{ fontFamily: font.sans, fontSize: 20, fontWeight: 700, color: color.ink }}>
                Pix confirmado
              </span>
              <span style={{ fontFamily: font.mono, fontSize: 17, color: color.inkMuted }}>Pedido #1042</span>
            </span>
          </div>
        </div>
      </MobileTextStage>
    </AbsoluteFill>
  );
};

/* ===================== 2 — publicar ===================== */

export const M2Publish: React.FC = () => {
  const frame = useCurrentFrame();
  const typed = interpolate(frame, [0, sec(1.0), sec(1.8)], [1, 2, 2], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const tapAt = 2.5;
  const pressed = frame >= sec(tapAt) && frame < sec(tapAt + 0.14) ? 1 : 0;
  const published = frame >= sec(tapAt + 0.1);
  const enter = progress(frame, 0, 0.55, EASE_OUT);
  const confirm = progress(frame, tapAt + 0.15, 0.5, EASE_OUT);

  return (
    <AbsoluteFill>
      <MobileScreen opacity={enter} lift={(1 - enter) * 16}>
        <ProductFormMobile typed={typed} pressed={pressed} published={published} />
      </MobileScreen>

      {/* O toque cai sobre o botão "Publicar produto" — coordenadas do
          quadro, já em escala final. */}
      <TouchRing x={540} y={939} frame={frame} atSeconds={tapAt} />

      <MobileLabel opacity={enter}>Você, no painel</MobileLabel>
      <MobileCallout opacity={confirm} transform={`translateY(${(1 - confirm) * 16}px)`} tone="green">
        <span
          style={{
            width: 34,
            height: 34,
            borderRadius: 999,
            background: color.success,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <CheckIcon size={19} strokeWidth={3} />
        </span>
        Produto no ar
      </MobileCallout>
    </AbsoluteFill>
  );
};

/* ===================== 3 — a loja ===================== */

export const M3Storefront: React.FC = () => {
  const frame = useCurrentFrame();
  const enter = progress(frame, 0, 0.5, EASE_OUT);

  // Rolagem: o topo (nome da loja, contagem, categorias) aparece
  // primeiro; depois a tela sobe e entrega o card inteiro, com o botão.
  // Medido no frame renderizado, não estimado: com 214 o botão ainda
  // ficava cortado pela base em ~45px. 260 entrega o card inteiro com
  // uma folga de ~10px até o fim da área rolável.
  const scroll = interpolate(frame, [sec(0.9), sec(2.0)], [0, 260], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_OUT,
  });

  const tapAt = 2.7;
  const pressed = frame >= sec(tapAt) && frame < sec(tapAt + 0.14) ? 1 : 0;
  const added = frame >= sec(tapAt + 0.1);

  return (
    <AbsoluteFill>
      <MobileScreen
        opacity={enter}
        lift={(1 - enter) * 16}
        scrollY={scroll}
        header={<StorefrontMobileHeader cartCount={added ? 1 : 0} />}
      >
        <StorefrontMobile added={added} pressed={pressed} />
      </MobileScreen>

      <TouchRing x={603} y={1138} frame={frame} atSeconds={tapAt} />

      <MobileLabel tone={color.success} opacity={enter}>
        Seu cliente, no seu link
      </MobileLabel>
    </AbsoluteFill>
  );
};

/* ===================== 4 — checkout e Pix ===================== */

/**
 * O celular do cliente ocupa quase todo o quadro vertical. Estas duas
 * cenas são as que mais ganham no formato: a tela de checkout e a de
 * Pix já foram desenhadas para celular, então aqui não há adaptação
 * nenhuma — é a interface no tamanho em que ela nasceu.
 */
/*
 * O telefone do cliente usa a MESMA régua das outras telas: base de
 * celular ampliada por 2,4. Escalar o aparelho inteiro para "caber" no
 * quadro devolvia texto de 6px na tela do usuário — o oposto do que
 * esta versão existe para resolver.
 */
const PHONE_W = 416;
const PHONE_VISIBLE_H = 450;

const PhoneStage: React.FC<{ children: React.ReactNode; opacity?: number; lift?: number; scrollY?: number }> = ({
  children,
  opacity = 1,
  lift = 0,
  scrollY = 0,
}) => (
  <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
    <div
      style={{
        width: PHONE_W,
        height: PHONE_VISIBLE_H,
        flex: "none",
        transform: `scale(2.4) translateY(${lift}px)`,
        transformOrigin: "center center",
        opacity,
        borderRadius: 18,
        overflow: "hidden",
        background: color.white,
        border: `1px solid ${color.lineStrong}`,
        boxShadow: shadow.device,
        position: "relative",
      }}
    >
      <div style={{ height: PHONE_VISIBLE_H, transform: `translateY(${-scrollY}px)` }}>{children}</div>
    </div>
  </AbsoluteFill>
);

export const M4Checkout: React.FC = () => {
  const frame = useCurrentFrame();
  const enter = progress(frame, 0, 0.7, EASE_OUT);

  const typed = interpolate(frame, [sec(0.5), sec(1.1), sec(1.6), sec(2.0)], [0, 1, 2, 3], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const tapAt = 2.45;
  const pressed = frame >= sec(tapAt) && frame < sec(tapAt + 0.14) ? 1 : 0;
  const toPix = progress(frame, tapAt + 0.12, 0.4, EASE_OUT);
  const qrReveal = progress(frame, tapAt + 0.3, 0.45, EASE_OUT);

  // A tela de checkout é mais alta que a caixa visível: rola até
  // entregar o botão "Enviar pedido" antes do toque. Depois volta ao
  // topo, porque a tela de Pix cabe inteira.
  const scroll = interpolate(frame, [sec(1.0), sec(2.1), sec(2.7)], [0, 118, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_OUT,
  });

  return (
    <AbsoluteFill>
      <PhoneStage opacity={enter} lift={(1 - enter) * 26} scrollY={toPix > 0.5 ? 0 : scroll}>
        <div style={{ position: "absolute", inset: 0, opacity: 1 - toPix }}>
          <CheckoutScreen typed={typed} pressed={pressed} />
        </div>
        <div
          style={{
            position: "absolute",
            inset: 0,
            opacity: toPix,
            transform: `translateY(${(1 - toPix) * 16}px)`,
          }}
        >
          <PixScreen reveal={qrReveal} compact />
        </div>
      </PhoneStage>

      <MobileCallout opacity={toPix} transform={`translateY(${(1 - toPix) * 14}px)`}>
        <span style={{ width: 12, height: 12, borderRadius: 999, background: color.warning }} />
        Pague com Pix · R$ 39,90
      </MobileCallout>
    </AbsoluteFill>
  );
};

export const M5PixConfirmed: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const approveAt = 0.4;
  const approved = Math.min(1, pop(frame, approveAt, fps));
  const haloT = progress(frame, approveAt, 1.1, (t) => t);
  const halo = haloT > 0 ? Math.sin(Math.PI * haloT) * 0.5 : 0;
  const label = progress(frame, approveAt + 0.3, 0.5);

  return (
    <AbsoluteFill>
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          width: 1200,
          height: 1200,
          marginLeft: -600,
          marginTop: -600,
          borderRadius: 999,
          background: "radial-gradient(circle, rgba(14, 159, 110, 0.16), transparent 62%)",
          opacity: halo,
        }}
      />
      <PhoneStage>
        <PixScreen reveal={1} approved={approved} compact />
      </PhoneStage>

      <MobileCallout opacity={label} transform={`translateY(${(1 - label) * 14}px)`} tone="green">
        <span
          style={{
            width: 34,
            height: 34,
            borderRadius: 999,
            background: color.success,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <CheckIcon size={19} strokeWidth={3} />
        </span>
        Pagamento confirmado
      </MobileCallout>
    </AbsoluteFill>
  );
};

/* ===================== 6 — pedido no painel ===================== */

export const M6Orders: React.FC = () => {
  const frame = useCurrentFrame();
  const enter = progress(frame, 0, 0.5, EASE_OUT);
  const newOrder = progress(frame, 0.65, 0.55, EASE_OUT);
  const highlight = Math.max(0, 1 - progress(frame, 1.5, 0.9, EASE_OUT));
  const callout = Math.min(progress(frame, 0.9, 0.4), 1 - progress(frame, 2.9, 0.4));

  return (
    <AbsoluteFill>
      <MobileScreen opacity={enter} lift={(1 - enter) * 16}>
        <OrdersMobile newOrder={newOrder} highlight={highlight} />
      </MobileScreen>

      <MobileLabel opacity={enter}>No seu painel, na hora</MobileLabel>
      <MobileCallout opacity={callout} transform={`translateY(${(1 - callout) * 14}px)`}>
        <span
          style={{
            width: 34,
            height: 34,
            borderRadius: 999,
            background: color.blue600,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <CheckIcon size={19} strokeWidth={3} />
        </span>
        Novo pedido
      </MobileCallout>
    </AbsoluteFill>
  );
};

/* ===================== 7 — estoque ===================== */

export const M7Stock: React.FC = () => {
  const frame = useCurrentFrame();
  const enter = progress(frame, 0, 0.45, EASE_OUT);
  const flip = progress(frame, 1.2, 0.5, EASE_OUT);
  const callout = Math.min(progress(frame, 1.45, 0.4), 1 - progress(frame, 2.65, 0.3));

  return (
    <AbsoluteFill>
      <MobileScreen opacity={enter} lift={(1 - enter) * 14}>
        <StockMobile flip={flip} />
      </MobileScreen>

      <MobileLabel opacity={enter}>E o estoque acompanha</MobileLabel>
      <MobileCallout opacity={callout} transform={`translateY(${(1 - callout) * 14}px)`}>
        <span
          style={{
            fontFamily: font.mono,
            fontSize: 30,
            fontWeight: 600,
            color: color.blue700,
            letterSpacing: "-0.02em",
          }}
        >
          −1
        </span>
        <span style={{ width: 1, height: 30, background: color.line }} />
        Estoque atualizado sozinho
      </MobileCallout>
    </AbsoluteFill>
  );
};

/* ===================== 8 — fechamento ===================== */

export const M8Close: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", padding: "0 80px" }}>
      <div style={{ width: "100%", display: "flex", flexDirection: "column", alignItems: "center" }}>
        <div style={{ ...rise(frame, 0.05, 20), marginBottom: 46 }}>
          <Logo scale={1.7} />
        </div>

        <div
          style={{
            fontFamily: font.display,
            fontWeight: 700,
            fontSize: 88,
            lineHeight: 1.06,
            letterSpacing: "-0.03em",
            color: color.ink,
            textAlign: "center",
          }}
        >
          <div style={rise(frame, 0.18, 20)}>Sua loja.</div>
          <div style={rise(frame, 0.28, 20)}>Seus pedidos.</div>
          <div style={{ color: color.blue600, ...rise(frame, 0.38, 20) }}>Seu Pix.</div>
        </div>

        <div
          style={{
            marginTop: 34,
            fontFamily: font.sans,
            fontSize: 32,
            color: color.inkMuted,
            textAlign: "center",
            ...rise(frame, 0.52, 18),
          }}
        >
          Mensalidade fixa, sem comissão
          <br />
          sobre as vendas.
        </div>

        <div style={{ marginTop: 58, width: 460, ...rise(frame, 0.66, 18) }}>
          <PrimaryButton height={96} fontSize={30}>
            Crie sua loja
          </PrimaryButton>
        </div>

        <div style={{ marginTop: 34, ...rise(frame, 0.78, 16) }}>
          <Logo scale={0.58} />
        </div>
      </div>
    </AbsoluteFill>
  );
};
