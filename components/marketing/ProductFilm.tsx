"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./ProductFilm.module.css";

/* ============================================================
   O filme de produto na landing

   Duas composições, não uma redimensionada: o 16:9 e o 4:5 têm
   enquadramentos diferentes porque a interface mostrada tem texto de
   14px, e num celular de 390px o corte do horizontal sairia com ~3px
   de altura de letra. A escolha é feita por `matchMedia`, não por CSS,
   para o navegador baixar UM arquivo só.

   O vídeo não carrega sozinho ao abrir a página: começa em
   `preload="none"` mostrando só o poster (80–90 KB), e a fonte só é
   atribuída quando o bloco chega perto da viewport. Fora da tela, ele
   pausa — decodificar vídeo que ninguém está vendo é gasto de bateria
   em celular.

   Sem áudio por construção; `muted` e `playsInline` também são o que
   torna o autoplay possível no iOS.
   ============================================================ */

const SOURCES = {
  desktop: {
    src: "/video/caraffastore-product-film-desktop-web.mp4",
    poster: "/video/caraffastore-product-film-desktop-poster.jpeg",
    width: 1920,
    height: 1080,
  },
  mobile: {
    src: "/video/caraffastore-product-film-mobile-web.mp4",
    poster: "/video/caraffastore-product-film-mobile-poster.jpeg",
    width: 1080,
    height: 1350,
  },
} as const;

/** Abaixo disso o 16:9 fica pequeno demais para a interface ser lida. */
const MOBILE_QUERY = "(max-width: 760px)";

export function ProductFilm() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const [variant, setVariant] = useState<"desktop" | "mobile">("desktop");
  const [near, setNear] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  // 1. Qual composição — reavaliada se a janela cruzar o breakpoint.
  //    O `resize` entra junto com o `change` porque nem todo ambiente
  //    dispara o evento da media query em redimensionamento
  //    programático, e aí a peça ficava travada no formato errado.
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY);
    const apply = () => setVariant(mq.matches ? "mobile" : "desktop");
    apply();
    mq.addEventListener("change", apply);
    window.addEventListener("resize", apply);
    return () => {
      mq.removeEventListener("change", apply);
      window.removeEventListener("resize", apply);
    };
  }, []);

  // 2. Quem pediu menos movimento não recebe autoplay: fica o poster e
  //    os controles, para assistir só se quiser.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReducedMotion(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  // 3. Só carrega perto da viewport, e pausa quando sai dela.
  //
  //    Com rede de segurança, pelo mesmo motivo do RevealRoot: este
  //    efeito ESCONDE conteúdo até liberá-lo, e um observer que não
  //    responde — aba em segundo plano no load, navegador que suspende
  //    o ciclo de render, ambiente headless — deixaria um retângulo
  //    vazio no lugar do filme. Se em 1,2s nada chegou, carrega assim
  //    mesmo: um vídeo baixado à toa é falha muito menor que um bloco
  //    em branco no meio da página.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;

    let responded = false;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        responded = true;
        if (entry.isIntersecting) setNear(true);
        const video = videoRef.current;
        if (!video || reducedMotion) return;
        if (entry.isIntersecting) void video.play().catch(() => {});
        else video.pause();
      },
      { rootMargin: "300px 0px" },
    );

    observer.observe(wrap);

    const fallback = window.setTimeout(() => {
      if (!responded) setNear(true);
    }, 1200);

    return () => {
      window.clearTimeout(fallback);
      observer.disconnect();
    };
  }, [reducedMotion]);

  // 4. Assim que a fonte é atribuída, tenta tocar. O autoplay do
  //    atributo só vale para a fonte presente na montagem, e aqui ela
  //    chega depois.
  useEffect(() => {
    if (!near || reducedMotion) return;
    const video = videoRef.current;
    if (!video) return;
    void video.play().catch(() => {});
  }, [near, variant, reducedMotion]);

  const source = SOURCES[variant];

  return (
    <div ref={wrapRef} className={styles.frame} data-variant={variant}>
      <video
        ref={videoRef}
        key={variant}
        className={styles.video}
        poster={source.poster}
        width={source.width}
        height={source.height}
        preload="none"
        muted
        loop
        playsInline
        controls={reducedMotion}
        autoPlay={!reducedMotion}
        aria-label="Demonstração da CaraffaStore: um comerciante publica um produto, um cliente compra e paga por Pix, e o pedido aparece no painel com o estoque atualizado."
        {...(near ? { src: source.src } : {})}
      />
    </div>
  );
}
