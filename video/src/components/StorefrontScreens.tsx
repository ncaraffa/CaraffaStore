import React from "react";
import { color, font, radius, shadow } from "../lib/theme";
import { CATALOG, ProductArt } from "./ProductArt";
import { Badge, CartIcon, CheckIcon, MonoLabel, PixIcon, PrimaryButton } from "./ui";

/* ============================================================
   Telas da loja pública

   Reprodução fiel de `app/loja/[storeSlug]/**`: rótulo "Catálogo" em
   mono, nome da loja em Inter peso 800 (a identidade visível ali é a do
   lojista, não a da CaraffaStore), contagem real de produtos e
   categorias, chips com o ativo em navy, card 1:1 com preço tabular,
   controle de quantidade ao lado de "Adicionar".

   O que o produto NÃO tem também é respeitado: a loja pública não tem
   logo, capa nem tema por loja — nada disso aparece aqui.
   ============================================================ */

export const StoreHeader: React.FC<{ cartCount: number; scale?: number }> = ({ cartCount, scale = 1 }) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: `${16 * scale}px ${24 * scale}px`,
      borderBottom: `1px solid ${color.line}`,
      background: color.white,
      flex: "none",
    }}
  >
    <span
      style={{
        fontFamily: font.sans,
        fontWeight: 800,
        fontSize: 18 * scale,
        letterSpacing: "-0.01em",
        color: color.ink,
      }}
    >
      Casa do Café
    </span>
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8 * scale,
        padding: `${6 * scale}px ${10 * scale}px`,
        borderRadius: radius.full,
        border: `1px solid ${color.line}`,
      }}
    >
      <CartIcon size={17 * scale} />
      <span
        style={{
          minWidth: 19 * scale,
          height: 19 * scale,
          padding: `0 ${5 * scale}px`,
          borderRadius: radius.full,
          background: cartCount > 0 ? color.blue600 : color.lineStrong,
          color: color.white,
          fontFamily: font.sans,
          fontSize: 12 * scale,
          fontWeight: 700,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {cartCount}
      </span>
    </div>
  </div>
);

export const ProductCard: React.FC<{
  index: number;
  highlight?: number;
  added?: boolean;
  pressed?: number;
}> = ({ index, highlight = 0, added = false, pressed = 0 }) => {
  const product = CATALOG[index]!;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        border: `1px solid ${highlight > 0 ? color.blue200 : color.line}`,
        borderRadius: radius.lg,
        padding: 12,
        background: color.white,
        boxShadow: highlight > 0 ? shadow.md : shadow.xs,
        transform: `translateY(${-3 * highlight}px)`,
      }}
    >
      <div
        style={{
          aspectRatio: "1 / 1",
          borderRadius: radius.md,
          overflow: "hidden",
          background: color.surface,
        }}
      >
        <ProductArt kind={product.art} uid={`cat${index}`} />
      </div>
      <span
        style={{
          fontFamily: font.sans,
          fontSize: 14,
          fontWeight: 600,
          lineHeight: 1.35,
          color: color.ink,
          minHeight: 38,
        }}
      >
        {product.name}
      </span>
      <span
        style={{
          fontFamily: font.sans,
          fontSize: 17,
          fontWeight: 700,
          color: color.ink,
          fontVariantNumeric: "tabular-nums",
          letterSpacing: "-0.015em",
        }}
      >
        {product.price}
      </span>
      <div style={{ display: "flex", gap: 6, marginTop: "auto" }}>
        <div
          style={{
            width: 42,
            height: 40,
            flex: "none",
            border: `1px solid ${color.lineStrong}`,
            borderRadius: radius.sm,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: font.sans,
            fontSize: 14,
            fontWeight: 600,
            color: color.ink,
          }}
        >
          1
        </div>
        <div style={{ flex: 1 }}>
          {added ? (
            <div
              style={{
                height: 40,
                borderRadius: radius.sm,
                background: color.successBg,
                border: `1px solid ${color.successBorder}`,
                color: color.successText,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                fontFamily: font.sans,
                fontSize: 14,
                fontWeight: 600,
              }}
            >
              <CheckIcon size={15} color={color.success} strokeWidth={3} />
              Adicionado
            </div>
          ) : (
            <PrimaryButton height={40} fontSize={14} pressed={pressed}>
              Adicionar
            </PrimaryButton>
          )}
        </div>
      </div>
    </div>
  );
};

/** Catálogo público em desktop — a grade de 4 colunas do produto real. */
export const StorefrontCatalog: React.FC<{
  cartCount: number;
  highlightIndex?: number;
  highlight?: number;
  addedIndex?: number | null;
  pressed?: number;
}> = ({ cartCount, highlightIndex = -1, highlight = 0, addedIndex = null, pressed = 0 }) => (
  <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: color.white }}>
    <StoreHeader cartCount={cartCount} />
    <div style={{ padding: "26px 34px", flex: 1, minHeight: 0 }}>
      <div style={{ paddingBottom: 18, marginBottom: 18, borderBottom: `1px solid ${color.line}` }}>
        <div style={{ marginBottom: 6 }}>
          <MonoLabel size={11}>Catálogo</MonoLabel>
        </div>
        <div
          style={{
            fontFamily: font.display,
            fontWeight: 700,
            fontSize: 34,
            letterSpacing: "-0.02em",
            color: color.ink,
            lineHeight: 1.15,
          }}
        >
          Casa do Café
        </div>
        <div
          style={{
            marginTop: 6,
            fontFamily: font.sans,
            fontSize: 14,
            color: color.inkMuted,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          4 produtos em 3 categorias
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <div
          style={{
            width: 300,
            height: 40,
            borderRadius: radius.md,
            border: `1px solid ${color.lineStrong}`,
            display: "flex",
            alignItems: "center",
            padding: "0 12px",
            fontFamily: font.sans,
            fontSize: 14,
            color: color.inkMuted,
          }}
        >
          Buscar produtos...
        </div>
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 20 }}>
        {["Todas", "Grãos", "Acessórios", "Presentes"].map((c, i) => (
          <span
            key={c}
            style={{
              padding: "7px 14px",
              borderRadius: radius.full,
              border: `1px solid ${i === 0 ? color.ink : color.line}`,
              background: i === 0 ? color.ink : color.white,
              color: i === 0 ? color.white : color.inkBody,
              fontFamily: font.sans,
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            {c}
          </span>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 18 }}>
        {CATALOG.map((_, i) => (
          <ProductCard
            key={i}
            index={i}
            highlight={i === highlightIndex ? highlight : 0}
            added={addedIndex === i}
            pressed={i === highlightIndex ? pressed : 0}
          />
        ))}
      </div>
    </div>
  </div>
);

/** Checkout em celular — os campos que o produto realmente pede. */
export const CheckoutScreen: React.FC<{ typed: number; pressed?: number }> = ({ typed, pressed = 0 }) => {
  const fields = [
    { label: "Nome", value: "Marina Alves" },
    { label: "Telefone / WhatsApp", value: "(11) 99999-8888" },
    { label: "E-mail", value: "marina@email.com" },
  ];

  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: color.white }}>
      <StoreHeader cartCount={1} scale={0.92} />
      <div style={{ padding: "20px 22px", flex: 1, minHeight: 0 }}>
        <div
          style={{
            fontFamily: font.display,
            fontWeight: 700,
            fontSize: 24,
            letterSpacing: "-0.02em",
            color: color.ink,
            marginBottom: 14,
          }}
        >
          Finalizar pedido
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            padding: "12px 14px",
            borderRadius: radius.md,
            background: color.surface,
            border: `1px solid ${color.line}`,
            marginBottom: 18,
          }}
        >
          <span style={{ fontFamily: font.sans, fontSize: 13, color: color.inkMuted }}>
            1 item · Café Especial 500 g
          </span>
          <span
            style={{
              fontFamily: font.sans,
              fontSize: 17,
              fontWeight: 700,
              color: color.ink,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            R$ 39,90
          </span>
        </div>

        <div style={{ marginBottom: 10 }}>
          <MonoLabel size={10}>Seus dados</MonoLabel>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {fields.map((f, i) => {
            const active = typed > i && typed < i + 1;
            const done = typed >= i + 1;
            const chars = done ? f.value.length : active ? Math.floor((typed - i) * f.value.length) : 0;
            return (
              <div key={f.label} style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                <span style={{ fontFamily: font.sans, fontSize: 12, fontWeight: 600, color: color.ink }}>
                  {f.label}
                </span>
                <div
                  style={{
                    height: 40,
                    borderRadius: radius.md,
                    border: `1px solid ${active ? color.blue600 : color.lineStrong}`,
                    boxShadow: active ? "0 0 0 3px rgba(27, 77, 255, 0.18)" : "none",
                    display: "flex",
                    alignItems: "center",
                    padding: "0 12px",
                    fontFamily: font.sans,
                    fontSize: 14,
                    color: color.inkBody,
                  }}
                >
                  {f.value.slice(0, chars)}
                  {active && <span style={{ width: 1.5, height: 17, background: color.blue600, marginLeft: 1 }} />}
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ marginTop: 18, marginBottom: 10 }}>
          <MonoLabel size={10}>Entrega</MonoLabel>
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
          {["Retirada", "Entrega"].map((o, i) => (
            <div
              key={o}
              style={{
                flex: 1,
                textAlign: "center",
                padding: "10px 0",
                borderRadius: radius.md,
                border: `1px solid ${i === 0 ? color.blue600 : color.lineStrong}`,
                background: i === 0 ? color.blue50 : color.white,
                color: i === 0 ? color.blue700 : color.inkBody,
                fontFamily: font.sans,
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              {o}
            </div>
          ))}
        </div>

        <PrimaryButton height={48} fontSize={15} pressed={pressed}>
          Enviar pedido
        </PrimaryButton>
        <div
          style={{
            marginTop: 10,
            textAlign: "center",
            fontFamily: font.sans,
            fontSize: 11,
            color: color.inkMuted,
          }}
        >
          Pagamento processado com segurança pelo Mercado Pago
        </div>
      </div>
    </div>
  );
};

/**
 * QR desenhado: marcadores de canto + módulos em posições FIXAS. Nada de
 * aleatoriedade — além de não ser um Pix real, um QR que muda a cada
 * frame apareceria tremendo no vídeo.
 */
const QR_MODULES = [
  [3, 3], [4, 3], [6, 3], [8, 3], [9, 3], [11, 3],
  [3, 4], [5, 4], [7, 4], [10, 4], [12, 4],
  [4, 5], [6, 5], [8, 5], [9, 5], [11, 5], [13, 5],
  [3, 6], [5, 6], [7, 6], [12, 6],
  [4, 7], [6, 7], [9, 7], [10, 7], [13, 7],
  [3, 8], [8, 8], [11, 8], [12, 8],
  [5, 9], [7, 9], [9, 9], [13, 9],
  [4, 10], [6, 10], [10, 10], [12, 10],
  [3, 11], [8, 11], [9, 11], [11, 11], [13, 11],
  [5, 12], [7, 12], [10, 12], [12, 12],
  [4, 13], [6, 13], [9, 13], [11, 13], [13, 13],
];

/**
 * O QR aparece INTEIRO, com fade e um leve crescimento — nunca módulo a
 * módulo. Revelar em sequência produzia, na maior parte da cena, um
 * código pela metade: a leitura não é "carregando", é "quebrado".
 */
export const QrCode: React.FC<{ size: number; reveal?: number }> = ({ size, reveal = 1 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 17 17"
    style={{ opacity: reveal, transform: `scale(${0.94 + reveal * 0.06})` }}
  >
    <rect width="17" height="17" fill="#ffffff" />
    {[
      [1, 1],
      [11, 1],
      [1, 11],
    ].map(([x, y]) => (
      <g key={`f${x}-${y}`}>
        <rect x={x} y={y} width="5" height="5" fill={color.ink} />
        <rect x={x! + 1} y={y! + 1} width="3" height="3" fill="#ffffff" />
        <rect x={x! + 1.75} y={y! + 1.75} width="1.5" height="1.5" fill={color.ink} />
      </g>
    ))}
    {QR_MODULES.map(([x, y]) => (
      <rect key={`m${x}-${y}`} x={x} y={y} width="1" height="1" fill={color.ink} />
    ))}
  </svg>
);

/** Tela de pagamento Pix do pedido — QR, copia e cola, expiração. */
export const PixScreen: React.FC<{
  reveal: number;
  approved?: number;
}> = ({ reveal, approved = 0 }) => {
  const isApproved = approved > 0;
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: color.white }}>
      <StoreHeader cartCount={0} scale={0.92} />
      {/* Centrado no eixo vertical: a página de Pix é curta, e ancorada no
          topo ela deixava metade do aparelho vazia. */}
      <div
        style={{
          padding: "20px 20px",
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            border: `1px solid ${color.line}`,
            borderRadius: radius.lg,
            overflow: "hidden",
            boxShadow: shadow.sm,
            background: color.white,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              padding: "12px 0",
              background: isApproved ? color.successBg : color.warningBg,
              borderBottom: `1px solid ${isApproved ? color.successBorder : color.warningBorder}`,
              color: isApproved ? color.successText : color.warningText,
              fontFamily: font.sans,
              fontSize: 14,
              fontWeight: 700,
            }}
          >
            {isApproved ? (
              <CheckIcon size={16} color={color.success} strokeWidth={3} />
            ) : (
              <PixIcon size={16} fill={color.warningText} />
            )}
            {isApproved ? "Pagamento aprovado" : "Aguardando pagamento"}
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 3,
              padding: "16px 16px 14px",
              margin: "0 16px",
              borderBottom: `1px dashed ${color.lineStrong}`,
            }}
          >
            <span style={{ fontFamily: font.sans, fontSize: 12, color: color.inkMuted }}>Valor do pedido</span>
            <span
              style={{
                fontFamily: font.display,
                fontSize: 30,
                fontWeight: 700,
                color: color.ink,
                letterSpacing: "-0.02em",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              R$ 39,90
            </span>
            <span style={{ fontFamily: font.mono, fontSize: 12, color: color.inkMuted }}>Pedido #1042</span>
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "center",
              padding: 18,
              position: "relative",
              minHeight: 190,
              alignItems: "center",
            }}
          >
            <div
              style={{
                width: 152,
                height: 152,
                border: `1px solid ${color.line}`,
                borderRadius: radius.sm,
                padding: 6,
                background: "#fff",
                opacity: isApproved ? 1 - approved : 1,
                transform: `scale(${isApproved ? 1 - approved * 0.12 : 1})`,
              }}
            >
              <QrCode size={140} reveal={reveal} />
            </div>

            {isApproved && (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  opacity: approved,
                  transform: `scale(${0.7 + approved * 0.3})`,
                }}
              >
                <div
                  style={{
                    width: 96,
                    height: 96,
                    borderRadius: 999,
                    background: color.success,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    boxShadow: `0 18px 40px -14px rgba(14, 159, 110, 0.75)`,
                  }}
                >
                  <CheckIcon size={46} strokeWidth={3} />
                </div>
              </div>
            )}
          </div>

          {!isApproved && (
            <>
              <div
                style={{
                  textAlign: "center",
                  fontFamily: font.sans,
                  fontSize: 13,
                  color: color.inkMuted,
                  marginBottom: 12,
                }}
              >
                Expira em <span style={{ fontFamily: font.mono, color: color.ink }}>14:52</span>
              </div>
              <div style={{ padding: "0 16px 16px" }}>
                <div
                  style={{
                    height: 38,
                    borderRadius: radius.md,
                    border: `1px solid ${color.lineStrong}`,
                    background: color.surface,
                    display: "flex",
                    alignItems: "center",
                    padding: "0 12px",
                    fontFamily: font.mono,
                    fontSize: 11,
                    color: color.inkBody,
                    overflow: "hidden",
                    whiteSpace: "nowrap",
                    marginBottom: 10,
                  }}
                >
                  00020126580014br.gov.bcb.pix…
                </div>
                <PrimaryButton height={44} fontSize={14}>
                  Copiar código
                </PrimaryButton>
              </div>
            </>
          )}

          {isApproved && (
            <div style={{ padding: "0 16px 18px", opacity: approved }}>
              <div
                style={{
                  padding: "12px 14px",
                  borderRadius: radius.md,
                  background: color.successBg,
                  border: `1px solid ${color.successBorder}`,
                  color: color.successText,
                  fontFamily: font.sans,
                  fontSize: 13,
                  lineHeight: 1.5,
                  textAlign: "center",
                }}
              >
                <strong>Pagamento confirmado!</strong>
                <br />O comerciante já foi avisado.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export const StoreBadge = Badge;
