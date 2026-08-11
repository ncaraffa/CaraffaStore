import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

/**
 * Favicon = a mesma marca de components/ui/Logo.tsx (jarra em geometria
 * fechada, cortada pela linha de nível), no mesmo selo cobalto usado no
 * header — nunca um ícone genérico diferente da marca real do produto.
 */
export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 7,
          background: "linear-gradient(150deg, #2e6bff, #143bd1 65%, #122fa0)",
        }}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
          <rect x="8.7" y="2.4" width="6.6" height="2.9" rx="1.45" fill="#fff" />
          <path
            fill="#fff"
            fillRule="evenodd"
            clipRule="evenodd"
            d="M9.6 5.1h4.8v3.1c0 1.05.45 2.05 1.24 2.74l2.16 1.96c1.14 1 1.8 2.45 1.8 3.97v.53a3.2 3.2 0 0 1-3.2 3.2H7.6a3.2 3.2 0 0 1-3.2-3.2v-.53c0-1.52.66-2.97 1.8-3.97l2.16-1.96C9.15 10.25 9.6 9.25 9.6 8.2V5.1ZM5.9 13.6h12.2v1.5H5.9v-1.5Z"
          />
        </svg>
      </div>
    ),
    { ...size },
  );
}
