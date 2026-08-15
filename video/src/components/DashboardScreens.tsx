import React from "react";
import { color, font, radius, shadow } from "../lib/theme";
import { ProductArt } from "./ProductArt";
import { Badge, CheckIcon, MonoLabel, PrimaryButton } from "./ui";
import { CaraffaMark } from "./Brand";

/* ============================================================
   Telas do painel do lojista

   Reprodução de `app/dashboard/**`: a sidebar com os cinco itens reais
   (Painel, Categorias, Produtos, Pedidos, Pagamentos), a tabela de
   produtos com as colunas Produto/Preço/Estoque/Status, a tabela de
   pedidos com Código/Cliente/Total/Status/Pagamento, e os mesmos
   rótulos de badge — "Publicado", "Confirmado", "Pago" — vindos de
   lib/orders/messages.ts e da lista de produtos.
   ============================================================ */

const NAV = ["Painel", "Categorias", "Produtos", "Pedidos", "Pagamentos"];

export const DashboardShell: React.FC<{
  active: string;
  children: React.ReactNode;
  breadcrumb: string;
}> = ({ active, children, breadcrumb }) => (
  <div style={{ width: "100%", height: "100%", display: "flex", background: color.surface }}>
    {/* Sidebar */}
    <div
      style={{
        width: 218,
        flex: "none",
        background: color.white,
        borderRight: `1px solid ${color.line}`,
        display: "flex",
        flexDirection: "column",
        padding: "20px 14px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 8px", marginBottom: 22 }}>
        <div
          style={{
            width: 30,
            height: 30,
            borderRadius: radius.sm,
            background: `linear-gradient(160deg, ${color.blue500}, ${color.blue700})`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <CaraffaMark size={18} fill="#ffffff" />
        </div>
        <span
          style={{
            fontFamily: font.display,
            fontWeight: 700,
            fontSize: 16,
            letterSpacing: "-0.02em",
            color: color.ink,
          }}
        >
          CaraffaStore
        </span>
      </div>

      <div style={{ padding: "0 8px", marginBottom: 10 }}>
        <MonoLabel size={10}>Casa do Café</MonoLabel>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {NAV.map((item) => {
          const isActive = item === active;
          return (
            <div
              key={item}
              style={{
                padding: "9px 10px",
                borderRadius: radius.sm,
                background: isActive ? color.blue50 : "transparent",
                color: isActive ? color.blue700 : color.inkBody,
                fontFamily: font.sans,
                fontSize: 14,
                fontWeight: isActive ? 600 : 500,
              }}
            >
              {item}
            </div>
          );
        })}
      </div>
    </div>

    {/* Conteúdo */}
    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
      <div
        style={{
          height: 52,
          flex: "none",
          borderBottom: `1px solid ${color.line}`,
          background: color.white,
          display: "flex",
          alignItems: "center",
          padding: "0 26px",
          fontFamily: font.sans,
          fontSize: 13,
          color: color.inkMuted,
        }}
      >
        Painel <span style={{ margin: "0 8px", color: color.inkFaint }}>/</span>
        <span style={{ color: color.ink, fontWeight: 600 }}>{breadcrumb}</span>
      </div>
      <div style={{ flex: 1, minHeight: 0, padding: "24px 26px", overflow: "hidden" }}>{children}</div>
    </div>
  </div>
);

const PageTitle: React.FC<{ title: string; subtitle: string }> = ({ title, subtitle }) => (
  <div style={{ marginBottom: 20 }}>
    <div
      style={{
        fontFamily: font.display,
        fontWeight: 700,
        fontSize: 26,
        letterSpacing: "-0.02em",
        color: color.ink,
      }}
    >
      {title}
    </div>
    <div style={{ marginTop: 4, fontFamily: font.sans, fontSize: 14, color: color.inkMuted }}>{subtitle}</div>
  </div>
);

/** Formulário de novo produto — os campos reais de `product-form.tsx`. */
export const ProductFormScreen: React.FC<{
  typed: number;
  pressed?: number;
  published?: boolean;
}> = ({ typed, pressed = 0, published = false }) => {
  const fields = [
    { label: "Nome", value: "Café Especial 500 g" },
    { label: "Preço (R$)", value: "39,90" },
    { label: "Categoria", value: "Grãos" },
  ];

  return (
    <DashboardShell active="Produtos" breadcrumb="Novo produto">
      <PageTitle title="Novo produto" subtitle="Cadastre o produto e publique quando quiser." />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "232px 1fr",
          gap: 24,
          background: color.white,
          border: `1px solid ${color.line}`,
          borderRadius: radius.lg,
          boxShadow: `${shadow.sm}, ${shadow.sheen}`,
          padding: 22,
        }}
      >
        <div>
          <div style={{ marginBottom: 8 }}>
            <MonoLabel size={10}>Foto</MonoLabel>
          </div>
          <div
            style={{
              width: 232,
              height: 232,
              borderRadius: radius.md,
              overflow: "hidden",
              border: `1px solid ${color.line}`,
              background: color.surface,
            }}
          >
            <ProductArt kind="bag" uid="form" />
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {fields.map((f, i) => {
            const active = typed > i && typed < i + 1;
            const done = typed >= i + 1;
            const chars = done ? f.value.length : active ? Math.floor((typed - i) * f.value.length) : 0;
            return (
              <div key={f.label} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ fontFamily: font.sans, fontSize: 13, fontWeight: 600, color: color.ink }}>
                  {f.label}
                </span>
                <div
                  style={{
                    height: 42,
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
                  {active && <span style={{ width: 1.5, height: 18, background: color.blue600, marginLeft: 1 }} />}
                </div>
              </div>
            );
          })}

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontFamily: font.sans, fontSize: 13, fontWeight: 600, color: color.ink }}>
              Estoque inicial
            </span>
            <div
              style={{
                width: 120,
                height: 42,
                borderRadius: radius.md,
                border: `1px solid ${color.lineStrong}`,
                display: "flex",
                alignItems: "center",
                padding: "0 12px",
                fontFamily: font.sans,
                fontSize: 14,
                color: color.inkBody,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              12
            </div>
          </div>

          <div style={{ marginTop: 6, width: 220 }}>
            {published ? (
              <div
                style={{
                  height: 46,
                  borderRadius: radius.md,
                  background: color.successBg,
                  border: `1px solid ${color.successBorder}`,
                  color: color.successText,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  fontFamily: font.sans,
                  fontSize: 15,
                  fontWeight: 600,
                }}
              >
                <CheckIcon size={17} color={color.success} strokeWidth={3} />
                Produto publicado
              </div>
            ) : (
              <PrimaryButton height={46} fontSize={15} pressed={pressed}>
                Publicar produto
              </PrimaryButton>
            )}
          </div>
        </div>
      </div>
    </DashboardShell>
  );
};

export type OrderRow = {
  code: string;
  customer: string;
  total: string;
  status: string;
  statusTone: "success" | "info" | "warning" | "neutral";
  payment: string;
  paymentTone: "success" | "warning" | "neutral";
};

const BASE_ORDERS: OrderRow[] = [
  {
    code: "7C93B0",
    customer: "Rafael Lima",
    total: "R$ 64,80",
    status: "Concluído",
    statusTone: "success",
    payment: "Pago",
    paymentTone: "success",
  },
  {
    code: "3A21D7",
    customer: "Bianca Souza",
    total: "R$ 29,90",
    status: "Em preparo",
    statusTone: "info",
    payment: "Pago",
    paymentTone: "success",
  },
];

/** Lista de pedidos — as colunas e os badges reais do painel. */
export const OrdersScreen: React.FC<{
  newOrder: number;
  toast: number;
}> = ({ newOrder, toast }) => (
  <DashboardShell active="Pedidos" breadcrumb="Pedidos">
    <div style={{ position: "relative" }}>
      <PageTitle title="Pedidos" subtitle="Acompanhe vendas, pagamentos e status de preparo." />

      {/* Aviso de pedido novo — entra e sai, não fica pendurado. */}
      <div
        style={{
          position: "absolute",
          top: -4,
          right: 0,
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "11px 16px",
          borderRadius: radius.md,
          background: color.white,
          border: `1px solid ${color.blue200}`,
          boxShadow: shadow.lg,
          opacity: toast,
          transform: `translateY(${(1 - toast) * -10}px)`,
        }}
      >
        <span
          style={{
            width: 26,
            height: 26,
            borderRadius: 999,
            background: color.blue600,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <CheckIcon size={14} strokeWidth={3} />
        </span>
        <span style={{ fontFamily: font.sans, fontSize: 14, fontWeight: 600, color: color.ink }}>Novo pedido</span>
      </div>

      <div
        style={{
          background: color.white,
          border: `1px solid ${color.line}`,
          borderRadius: radius.lg,
          boxShadow: `${shadow.sm}, ${shadow.sheen}`,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "120px 1fr 130px 150px 140px",
            padding: "12px 18px",
            borderBottom: `1px solid ${color.line}`,
            background: color.surface,
          }}
        >
          {["Código", "Cliente", "Total", "Status", "Pagamento"].map((h) => (
            <span
              key={h}
              style={{
                fontFamily: font.sans,
                fontSize: 12,
                fontWeight: 600,
                color: color.inkMuted,
                letterSpacing: "0.02em",
              }}
            >
              {h}
            </span>
          ))}
        </div>

        {/* Linha nova: entra empurrando as demais para baixo. */}
        <div
          style={{
            height: newOrder * 62,
            opacity: newOrder,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "120px 1fr 130px 150px 140px",
              alignItems: "center",
              padding: "0 18px",
              height: 62,
              borderBottom: `1px solid ${color.line}`,
              background: `rgba(240, 245, 255, ${1 - newOrder * 0.55})`,
              transform: `translateY(${(1 - newOrder) * -14}px)`,
            }}
          >
            <span style={{ fontFamily: font.mono, fontSize: 13, fontWeight: 500, color: color.ink }}>1042</span>
            <span style={{ fontFamily: font.sans, fontSize: 14, color: color.inkBody }}>Marina Alves</span>
            <span
              style={{
                fontFamily: font.sans,
                fontSize: 14,
                fontWeight: 700,
                color: color.ink,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              R$ 39,90
            </span>
            <span>
              <Badge tone="info">Confirmado</Badge>
            </span>
            <span>
              <Badge tone="success">Pago</Badge>
            </span>
          </div>
        </div>

        {BASE_ORDERS.map((o) => (
          <div
            key={o.code}
            style={{
              display: "grid",
              gridTemplateColumns: "120px 1fr 130px 150px 140px",
              alignItems: "center",
              padding: "0 18px",
              height: 62,
              borderBottom: `1px solid ${color.line}`,
            }}
          >
            <span style={{ fontFamily: font.mono, fontSize: 13, fontWeight: 500, color: color.ink }}>{o.code}</span>
            <span style={{ fontFamily: font.sans, fontSize: 14, color: color.inkBody }}>{o.customer}</span>
            <span
              style={{
                fontFamily: font.sans,
                fontSize: 14,
                fontWeight: 700,
                color: color.ink,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {o.total}
            </span>
            <span>
              <Badge tone={o.statusTone}>{o.status}</Badge>
            </span>
            <span>
              <Badge tone={o.paymentTone}>{o.payment}</Badge>
            </span>
          </div>
        ))}
      </div>
    </div>
  </DashboardShell>
);

/** Lista de produtos com a coluna de estoque — "N un.", como no produto. */
export const ProductsStockScreen: React.FC<{ stockFlip: number }> = ({ stockFlip }) => {
  const rows = [
    { name: "Café Especial 500 g", art: "bag" as const, price: "R$ 39,90", stock: null },
    { name: "Coador Artesanal", art: "dripper" as const, price: "R$ 29,90", stock: 8 },
    { name: "Caneca Casa do Café", art: "mug" as const, price: "R$ 34,90", stock: 15 },
  ];

  return (
    <DashboardShell active="Produtos" breadcrumb="Produtos">
      <PageTitle title="Produtos" subtitle="Seu catálogo, preços e estoque." />

      <div
        style={{
          background: color.white,
          border: `1px solid ${color.line}`,
          borderRadius: radius.lg,
          boxShadow: `${shadow.sm}, ${shadow.sheen}`,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 130px 150px 140px",
            padding: "12px 18px",
            borderBottom: `1px solid ${color.line}`,
            background: color.surface,
          }}
        >
          {["Produto", "Preço", "Estoque", "Status"].map((h) => (
            <span
              key={h}
              style={{ fontFamily: font.sans, fontSize: 12, fontWeight: 600, color: color.inkMuted }}
            >
              {h}
            </span>
          ))}
        </div>

        {rows.map((r) => (
          <div
            key={r.name}
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 130px 150px 140px",
              alignItems: "center",
              padding: "0 18px",
              height: 70,
              borderBottom: `1px solid ${color.line}`,
              background: r.stock === null ? `rgba(240, 245, 255, ${stockFlip * 0.5})` : "transparent",
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
                  flex: "none",
                }}
              >
                <ProductArt kind={r.art} uid={`stk-${r.art}`} />
              </span>
              <span style={{ fontFamily: font.sans, fontSize: 14, fontWeight: 600, color: color.ink }}>{r.name}</span>
            </span>

            <span
              style={{
                fontFamily: font.sans,
                fontSize: 14,
                fontWeight: 700,
                color: color.ink,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {r.price}
            </span>

            <span
              style={{
                fontFamily: font.sans,
                fontSize: 15,
                fontWeight: 600,
                color: color.ink,
                fontVariantNumeric: "tabular-nums",
                position: "relative",
                display: "inline-block",
                height: 22,
                // A máscara é o que faz a troca ler como UM número que
                // muda. Sem ela, os dois valores apareciam juntos no meio
                // da animação e a linha parecia um erro de renderização.
                overflow: "hidden",
                width: 80,
              }}
            >
              {r.stock === null ? (
                <>
                  <span
                    style={{
                      position: "absolute",
                      left: 0,
                      top: 0,
                      opacity: 1 - stockFlip,
                      transform: `translateY(${-stockFlip * 22}px)`,
                    }}
                  >
                    12 un.
                  </span>
                  <span
                    style={{
                      position: "absolute",
                      left: 0,
                      top: 0,
                      opacity: stockFlip,
                      transform: `translateY(${(1 - stockFlip) * 22}px)`,
                      color: stockFlip > 0.5 ? color.blue700 : color.ink,
                    }}
                  >
                    11 un.
                  </span>
                </>
              ) : (
                `${r.stock} un.`
              )}
            </span>

            <span>
              <Badge tone="success">Publicado</Badge>
            </span>
          </div>
        ))}
      </div>
    </DashboardShell>
  );
};
