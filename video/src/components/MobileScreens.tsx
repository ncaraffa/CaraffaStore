import React from "react";
import { color, font, radius, shadow } from "../lib/theme";
import { CATALOG, ProductArt } from "./ProductArt";
import { Badge, CartIcon, CheckIcon, MonoLabel, PrimaryButton } from "./ui";
import { CaraffaMark } from "./Brand";
import { BASE_W } from "./MobileStage";

/* ============================================================
   Telas do filme vertical

   Reproduzem o layout que a aplicação JÁ SERVE em largura de celular:
   formulário em coluna única, catálogo de uma coluna, e a lista de
   pedidos/produtos em cards (a aplicação troca a tabela por
   `.cardList` no mobile — não é uma tabela espremida).

   Ou seja: o filme vertical não inventa uma interface para caber; ele
   mostra a interface mobile que existe.
   ============================================================ */

const PAD = 16;

const MobileTopBar: React.FC<{ title: string; breadcrumb?: string }> = ({ title, breadcrumb }) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      gap: 10,
      padding: `12px ${PAD}px`,
      borderBottom: `1px solid ${color.line}`,
      background: color.white,
    }}
  >
    <div
      style={{
        width: 26,
        height: 26,
        borderRadius: radius.sm,
        background: `linear-gradient(160deg, ${color.blue500}, ${color.blue700})`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flex: "none",
      }}
    >
      <CaraffaMark size={16} fill="#fff" />
    </div>
    <span style={{ fontFamily: font.sans, fontSize: 14, fontWeight: 700, color: color.ink }}>{title}</span>
    {breadcrumb && (
      <span style={{ marginLeft: "auto", fontFamily: font.sans, fontSize: 12, color: color.inkMuted }}>
        {breadcrumb}
      </span>
    )}
  </div>
);

const FieldRow: React.FC<{ label: string; value: string; chars?: number; active?: boolean; width?: number }> = ({
  label,
  value,
  chars,
  active = false,
  width,
}) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 6, width }}>
    <span style={{ fontFamily: font.sans, fontSize: 13, fontWeight: 600, color: color.ink }}>{label}</span>
    <div
      style={{
        height: 44,
        borderRadius: radius.md,
        border: `1px solid ${active ? color.blue600 : color.lineStrong}`,
        boxShadow: active ? "0 0 0 3px rgba(27, 77, 255, 0.18)" : "none",
        display: "flex",
        alignItems: "center",
        padding: "0 12px",
        fontFamily: font.sans,
        // 16, não 15: a 320px de largura o valor aparente caía para
        // 10,7px — abaixo do piso de 11px que a versão vertical assume.
        fontSize: 16,
        color: color.inkBody,
      }}
    >
      {chars === undefined ? value : value.slice(0, chars)}
      {active && <span style={{ width: 2, height: 19, background: color.blue600, marginLeft: 1 }} />}
    </div>
  </div>
);

/** Cena 2 vertical — formulário de produto em coluna única. */
export const ProductFormMobile: React.FC<{
  typed: number;
  pressed?: number;
  published?: boolean;
}> = ({ typed, pressed = 0, published = false }) => {
  const fields = [
    { label: "Nome", value: "Café Especial 500 g" },
    { label: "Preço (R$)", value: "39,90" },
  ];

  return (
    <div style={{ width: BASE_W, background: color.surface, minHeight: 562 }}>
      <MobileTopBar title="CaraffaStore" breadcrumb="Novo produto" />
      <div style={{ padding: PAD }}>
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
          Novo produto
        </div>

        <div
          style={{
            background: color.white,
            border: `1px solid ${color.line}`,
            borderRadius: radius.lg,
            boxShadow: `${shadow.sm}, ${shadow.sheen}`,
            padding: 14,
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <div style={{ display: "flex", gap: 12, alignItems: "flex-end" }}>
            <div
              style={{
                width: 104,
                height: 104,
                flex: "none",
                borderRadius: radius.md,
                overflow: "hidden",
                border: `1px solid ${color.line}`,
              }}
            >
              <ProductArt kind="bag" uid="mform" />
            </div>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 12 }}>
              {fields.map((f, i) => {
                const active = typed > i && typed < i + 1;
                const done = typed >= i + 1;
                const chars = done ? f.value.length : active ? Math.floor((typed - i) * f.value.length) : 0;
                return <FieldRow key={f.label} label={f.label} value={f.value} chars={chars} active={active} />;
              })}
            </div>
          </div>

          <FieldRow label="Estoque inicial" value="12" width={132} />

          <div style={{ marginTop: 4 }}>
            {published ? (
              <div
                style={{
                  height: 52,
                  borderRadius: radius.md,
                  background: color.successBg,
                  border: `1px solid ${color.successBorder}`,
                  color: color.successText,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 10,
                  fontFamily: font.sans,
                  fontSize: 17,
                  fontWeight: 700,
                }}
              >
                <CheckIcon size={20} color={color.success} strokeWidth={3} />
                Produto publicado
              </div>
            ) : (
              <PrimaryButton height={52} fontSize={17} pressed={pressed}>
                Publicar produto
              </PrimaryButton>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

/** Cabeçalho fixo da loja — o mesmo `position: sticky` do produto. */
export const StorefrontMobileHeader: React.FC<{ cartCount: number }> = ({ cartCount }) => (
  <div style={{ width: BASE_W, background: color.white }}>
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: `13px ${PAD}px`,
        borderBottom: `1px solid ${color.line}`,
      }}
    >
        <span style={{ fontFamily: font.sans, fontWeight: 800, fontSize: 17, color: color.ink }}>Casa do Café</span>
        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            padding: "5px 9px",
            borderRadius: radius.full,
            border: `1px solid ${color.line}`,
          }}
        >
          <CartIcon size={16} />
          <span
            style={{
              minWidth: 18,
              height: 18,
              borderRadius: radius.full,
              background: cartCount > 0 ? color.blue600 : color.lineStrong,
              color: "#fff",
              fontFamily: font.sans,
              fontSize: 11,
              fontWeight: 700,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
          {cartCount}
        </span>
      </span>
    </div>
  </div>
);

/** Corpo rolável do catálogo. */
export const StorefrontMobile: React.FC<{
  added?: boolean;
  pressed?: number;
}> = ({ added = false, pressed = 0 }) => {
  const first = CATALOG[0]!;
  const second = CATALOG[1]!;

  return (
    <div style={{ width: BASE_W, background: color.white }}>
      <div style={{ padding: PAD }}>
        <div style={{ paddingBottom: 12, marginBottom: 12, borderBottom: `1px solid ${color.line}` }}>
          <MonoLabel size={11}>Catálogo</MonoLabel>
          <div
            style={{
              marginTop: 4,
              fontFamily: font.display,
              fontWeight: 700,
              fontSize: 26,
              letterSpacing: "-0.02em",
              color: color.ink,
            }}
          >
            Casa do Café
          </div>
          <div style={{ marginTop: 4, fontFamily: font.sans, fontSize: 13, color: color.inkMuted }}>
            4 produtos em 3 categorias
          </div>
        </div>

        <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
          {["Todas", "Grãos", "Acessórios"].map((c, i) => (
            <span
              key={c}
              style={{
                padding: "6px 12px",
                borderRadius: radius.full,
                border: `1px solid ${i === 0 ? color.ink : color.line}`,
                background: i === 0 ? color.ink : color.white,
                color: i === 0 ? "#fff" : color.inkBody,
                fontFamily: font.sans,
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              {c}
            </span>
          ))}
        </div>

        {[first, second].map((p, idx) => (
          <div
            key={p.name}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 9,
              border: `1px solid ${idx === 0 && added ? color.blue200 : color.line}`,
              borderRadius: radius.lg,
              padding: 12,
              marginBottom: 14,
              background: color.white,
              boxShadow: shadow.xs,
            }}
          >
            <div style={{ aspectRatio: "1 / 1", borderRadius: radius.md, overflow: "hidden" }}>
              <ProductArt kind={p.art} uid={`m${idx}`} />
            </div>
            <span style={{ fontFamily: font.sans, fontSize: 16, fontWeight: 600, color: color.ink }}>{p.name}</span>
            <span
              style={{
                fontFamily: font.sans,
                fontSize: 20,
                fontWeight: 700,
                color: color.ink,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {p.price}
            </span>
            <div style={{ display: "flex", gap: 7 }}>
              <span
                style={{
                  width: 46,
                  height: 44,
                  flex: "none",
                  border: `1px solid ${color.lineStrong}`,
                  borderRadius: radius.sm,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontFamily: font.sans,
                  fontSize: 15,
                  fontWeight: 600,
                  color: color.ink,
                }}
              >
                1
              </span>
              <span style={{ flex: 1 }}>
                {idx === 0 && added ? (
                  <span
                    style={{
                      height: 44,
                      borderRadius: radius.sm,
                      background: color.successBg,
                      border: `1px solid ${color.successBorder}`,
                      color: color.successText,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 7,
                      fontFamily: font.sans,
                      fontSize: 15,
                      fontWeight: 700,
                    }}
                  >
                    <CheckIcon size={16} color={color.success} strokeWidth={3} />
                    Adicionado
                  </span>
                ) : (
                  <PrimaryButton height={44} fontSize={15} pressed={idx === 0 ? pressed : 0}>
                    Adicionar
                  </PrimaryButton>
                )}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

/** Cena 6 vertical — pedidos como cards, o layout mobile do painel. */
export const OrdersMobile: React.FC<{ newOrder: number; highlight: number }> = ({ newOrder, highlight }) => {
  const rest = [
    { code: "7C93B0", customer: "Rafael Lima", total: "R$ 64,80", status: "Concluído", tone: "success" as const },
    { code: "3A21D7", customer: "Bianca Souza", total: "R$ 29,90", status: "Em preparo", tone: "info" as const },
  ];

  return (
    <div style={{ width: BASE_W, background: color.surface, minHeight: 562 }}>
      <MobileTopBar title="CaraffaStore" breadcrumb="Pedidos" />
      <div style={{ padding: PAD }}>
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
          Pedidos
        </div>

        <div style={{ height: newOrder * 132, overflow: "hidden", opacity: newOrder }}>
          <div
            style={{
              position: "relative",
              border: `1px solid ${color.blue200}`,
              borderRadius: radius.lg,
              padding: 14,
              marginBottom: 12,
              background: `rgba(222, 233, 255, ${Math.max(0.12, highlight * 0.9)})`,
              boxShadow: shadow.md,
              transform: `translateY(${(1 - newOrder) * -16}px)`,
            }}
          >
            <span
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                bottom: 0,
                width: 4,
                borderRadius: "3px 0 0 3px",
                background: color.blue600,
                opacity: highlight,
              }}
            />
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={{ fontFamily: font.mono, fontSize: 16, fontWeight: 600, color: color.ink }}>#1042</span>
              <span
                style={{
                  fontFamily: font.sans,
                  fontSize: 21,
                  fontWeight: 700,
                  color: color.ink,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                R$ 39,90
              </span>
            </div>
            <div style={{ fontFamily: font.sans, fontSize: 15, color: color.inkBody, marginBottom: 10 }}>
              Marina Alves
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <Badge tone="info" size={13}>
                Confirmado
              </Badge>
              <Badge tone="success" size={13}>
                Pago
              </Badge>
            </div>
          </div>
        </div>

        {rest.map((o) => (
          <div
            key={o.code}
            style={{
              border: `1px solid ${color.line}`,
              borderRadius: radius.lg,
              padding: 14,
              marginBottom: 12,
              background: color.white,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={{ fontFamily: font.mono, fontSize: 16, fontWeight: 600, color: color.ink }}>
                #{o.code}
              </span>
              <span
                style={{
                  fontFamily: font.sans,
                  fontSize: 21,
                  fontWeight: 700,
                  color: color.ink,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {o.total}
              </span>
            </div>
            <div style={{ fontFamily: font.sans, fontSize: 15, color: color.inkBody, marginBottom: 10 }}>
              {o.customer}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <Badge tone={o.tone} size={13}>
                {o.status}
              </Badge>
              <Badge tone="success" size={13}>
                Pago
              </Badge>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

/**
 * Cena 7 vertical — o card de produto do painel mobile, com o estoque
 * como informação de maior peso do cartão. É o mesmo dado da coluna
 * "Estoque" da tabela desktop; no celular a aplicação já o apresenta em
 * card, e é esse layout que aparece aqui.
 */
export const StockMobile: React.FC<{ flip: number }> = ({ flip }) => (
  <div style={{ width: BASE_W, background: color.surface, minHeight: 562 }}>
    <MobileTopBar title="CaraffaStore" breadcrumb="Produtos" />
    <div style={{ padding: PAD }}>
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
        Produtos
      </div>

      <div
        style={{
          border: `1px solid ${flip > 0.2 ? color.blue200 : color.line}`,
          borderRadius: radius.lg,
          padding: 16,
          background: color.white,
          boxShadow: shadow.md,
          marginBottom: 12,
        }}
      >
        <div style={{ display: "flex", gap: 14, alignItems: "center", marginBottom: 16 }}>
          <div
            style={{
              width: 76,
              height: 76,
              flex: "none",
              borderRadius: radius.md,
              overflow: "hidden",
              border: `1px solid ${color.line}`,
            }}
          >
            <ProductArt kind="bag" uid="mstock" />
          </div>
          <div>
            <div style={{ fontFamily: font.sans, fontSize: 17, fontWeight: 700, color: color.ink }}>
              Café Especial 500 g
            </div>
            <div
              style={{
                marginTop: 4,
                fontFamily: font.sans,
                fontSize: 17,
                fontWeight: 600,
                color: color.inkBody,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              R$ 39,90
            </div>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            paddingTop: 14,
            borderTop: `1px solid ${color.line}`,
          }}
        >
          <span style={{ fontFamily: font.sans, fontSize: 15, color: color.inkMuted }}>Estoque</span>

          {/* Máscara: um número só visível por vez. Sem ela, os dois
              aparecem juntos no meio da troca e a linha lê como erro. */}
          <span
            style={{
              position: "relative",
              display: "inline-block",
              height: 46,
              width: 132,
              overflow: "hidden",
            }}
          >
            {[
              { text: "12 un.", o: 1 - flip, dy: -flip * 46, c: color.ink },
              { text: "11 un.", o: flip, dy: (1 - flip) * 46, c: color.blue600 },
            ].map((n) => (
              <span
                key={n.text}
                style={{
                  position: "absolute",
                  right: 0,
                  top: 0,
                  fontFamily: font.display,
                  fontSize: 38,
                  fontWeight: 700,
                  letterSpacing: "-0.03em",
                  fontVariantNumeric: "tabular-nums",
                  opacity: n.o,
                  transform: `translateY(${n.dy}px)`,
                  color: n.c,
                }}
              >
                {n.text}
              </span>
            ))}
          </span>
        </div>
      </div>

      <div
        style={{
          border: `1px solid ${color.line}`,
          borderRadius: radius.lg,
          padding: 14,
          background: color.white,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span
            style={{
              width: 44,
              height: 44,
              borderRadius: radius.sm,
              overflow: "hidden",
              border: `1px solid ${color.line}`,
            }}
          >
            <ProductArt kind="dripper" uid="mstock2" />
          </span>
          <span style={{ fontFamily: font.sans, fontSize: 15, fontWeight: 600, color: color.ink }}>
            Coador Artesanal
          </span>
        </span>
        <span
          style={{
            fontFamily: font.sans,
            fontSize: 17,
            fontWeight: 600,
            color: color.ink,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          8 un.
        </span>
      </div>
    </div>
  </div>
);
