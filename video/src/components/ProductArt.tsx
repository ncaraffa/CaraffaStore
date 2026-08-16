import React from "react";

/**
 * "Fotos" dos produtos da Casa do Café.
 *
 * Mesma decisão de `components/marketing/StorefrontDemo.tsx`: vetor
 * desenhado à mão, nunca foto de banco de imagens fingindo ser uma loja
 * real. Aqui os desenhos são os mesmos da demonstração da landing, para
 * o vídeo e o site mostrarem literalmente a mesma vitrine.
 *
 * Cada produto tem seu par de cores de fundo — quatro cards lado a lado
 * não podem virar quatro retângulos bege iguais.
 */

export type ArtKind = "bag" | "dripper" | "mug" | "grinder";

const BACKGROUND: Record<ArtKind, [string, string]> = {
  bag: ["#f6efe6", "#e9dccb"],
  dripper: ["#f2f0ea", "#e2ded2"],
  mug: ["#eef2fa", "#dde5f4"],
  grinder: ["#f1f0ee", "#dfdedb"],
};

export const ProductArt: React.FC<{ kind: ArtKind; uid?: string }> = ({ kind, uid = "a" }) => {
  const [from, to] = BACKGROUND[kind];
  const gid = `film-${kind}-${uid}`;

  return (
    <svg viewBox="0 0 120 120" style={{ width: "100%", height: "100%", display: "block" }}>
      <defs>
        <linearGradient id={`${gid}-bg`} x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0" stopColor={from} />
          <stop offset="1" stopColor={to} />
        </linearGradient>
        <linearGradient id={`${gid}-body`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.28" />
          <stop offset="0.45" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="1" stopColor="#000000" stopOpacity="0.14" />
        </linearGradient>
      </defs>

      <rect width="120" height="120" fill={`url(#${gid}-bg)`} />
      <ellipse cx="60" cy="99" rx="30" ry="5.5" fill="#4a3a2a" opacity="0.14" />

      {kind === "bag" && (
        <g>
          <path d="M41 36h38l4.5 52a9 9 0 0 1-9 9.8H45.5a9 9 0 0 1-9-9.8L41 36Z" fill="#4b3524" />
          <path d="M41 36h38l4.5 52a9 9 0 0 1-9 9.8H60V36Z" fill="#3d2b1d" />
          <path d="M41 36h38l4.5 52a9 9 0 0 1-9 9.8H45.5a9 9 0 0 1-9-9.8L41 36Z" fill={`url(#${gid}-body)`} />
          <path d="M45 25h30a3 3 0 0 1 3 3v8H42v-8a3 3 0 0 1 3-3Z" fill="#5d432e" />
          <rect x="52" y="21" width="16" height="6" rx="3" fill="#8c6b4a" />
          <rect x="47" y="52" width="26" height="30" rx="3" fill="#f4ece0" />
          <rect x="51" y="58" width="18" height="3" rx="1.5" fill="#4b3524" />
          <rect x="51" y="65" width="12" height="2.5" rx="1.25" fill="#8c6b4a" />
          <rect x="51" y="73" width="18" height="3" rx="1.5" fill="#d9c4a6" />
          <rect x="51" y="73" width="11" height="3" rx="1.5" fill="#1b4dff" opacity="0.75" />
        </g>
      )}

      {kind === "dripper" && (
        <g>
          <path d="M42 70h36v14a12 12 0 0 1-12 12H54a12 12 0 0 1-12-12V70Z" fill="#dfe6f0" opacity="0.85" />
          <path d="M42 78h36v6a12 12 0 0 1-12 12H54a12 12 0 0 1-12-12v-6Z" fill="#6b4a2f" opacity="0.55" />
          <rect x="40" y="66" width="40" height="5" rx="2.5" fill="#8c6b4a" />
          <path d="M36 40h48l-9 22a4 4 0 0 1-3.6 2.3H48.6A4 4 0 0 1 45 62L36 40Z" fill="#f7f3ea" />
          <path d="M36 40h48l-9 22a4 4 0 0 1-3.6 2.3H60V40Z" fill="#e7e0d2" />
          <path d="M36 40h48l-2.2 5.4H38.2L36 40Z" fill="#c9bda9" />
          <path d="M36 40h48l-9 22a4 4 0 0 1-3.6 2.3H48.6A4 4 0 0 1 45 62L36 40Z" fill={`url(#${gid}-body)`} />
          <rect x="58.5" y="64" width="3" height="9" rx="1.5" fill="#6b4a2f" opacity="0.6" />
        </g>
      )}

      {kind === "mug" && (
        <g>
          <path
            d="M50 28c3-4-3-7 0-11M60 26c3-4-3-7 0-11M70 28c3-4-3-7 0-11"
            stroke="#98a6bd"
            strokeWidth="2.4"
            strokeLinecap="round"
            fill="none"
            opacity="0.55"
          />
          <path d="M76 56h7a11 11 0 0 1 0 22h-7" fill="none" stroke="#e3e9f4" strokeWidth="9" strokeLinecap="round" />
          <path d="M76 56h7a11 11 0 0 1 0 22h-7" fill="none" stroke="#c5d1e6" strokeWidth="3" strokeLinecap="round" />
          <path d="M36 44h42v33a17 17 0 0 1-17 17H53a17 17 0 0 1-17-17V44Z" fill="#ffffff" />
          <path d="M36 44h42v9H36z" fill="#1b4dff" opacity="0.82" />
          <path d="M36 44h42v33a17 17 0 0 1-17 17H53a17 17 0 0 1-17-17V44Z" fill={`url(#${gid}-body)`} />
          <ellipse cx="57" cy="44" rx="21" ry="4.4" fill="#f0f4fc" />
          <ellipse cx="57" cy="44" rx="16" ry="3" fill="#3a2a1c" opacity="0.75" />
        </g>
      )}

      {kind === "grinder" && (
        <g>
          <path d="M60 20v9" stroke="#8a9099" strokeWidth="3.4" strokeLinecap="round" />
          <path d="M60 22h16a4 4 0 0 1 4 4v3" stroke="#8a9099" strokeWidth="3.4" strokeLinecap="round" fill="none" />
          <rect x="75" y="28" width="10" height="7" rx="3.5" fill="#6b4a2f" />
          <path d="M46 34h28a4 4 0 0 1 4 4v6H42v-6a4 4 0 0 1 4-4Z" fill="#aeb5bf" />
          <rect x="42" y="44" width="36" height="26" rx="4" fill="#c3c9d2" />
          <rect x="42" y="44" width="36" height="26" rx="4" fill={`url(#${gid}-body)`} />
          <rect x="45" y="53" width="30" height="3" rx="1.5" fill="#8a9099" opacity="0.5" />
          <path d="M44 72h32a4 4 0 0 1 4 4v14a6 6 0 0 1-6 6H46a6 6 0 0 1-6-6V76a4 4 0 0 1 4-4Z" fill="#7a5637" />
          <path d="M44 72h32a4 4 0 0 1 4 4v14a6 6 0 0 1-6 6H60V72Z" fill="#66462c" />
          <rect x="52" y="80" width="16" height="3.4" rx="1.7" fill="#e6d6c0" opacity="0.55" />
        </g>
      )}
    </svg>
  );
};

export const CATALOG: { name: string; price: string; art: ArtKind }[] = [
  { name: "Café Especial 500 g", price: "R$ 39,90", art: "bag" },
  { name: "Coador Artesanal", price: "R$ 29,90", art: "dripper" },
  { name: "Caneca Casa do Café", price: "R$ 34,90", art: "mug" },
  { name: "Moedor Manual", price: "R$ 89,90", art: "grinder" },
];
