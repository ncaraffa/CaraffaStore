"use client";

import { useState } from "react";
import styles from "./product-detail.module.css";

/**
 * Imagem principal grande + tira de miniaturas clicáveis — em vez de um
 * grid onde todas as fotos têm o mesmo peso. Só precisa de estado porque
 * trocar a imagem em destaque é uma interação real, não decoração.
 */
export function ProductGallery({ images, alt }: { images: { id: string; url: string }[]; alt: string }) {
  const [activeIndex, setActiveIndex] = useState(0);

  if (images.length === 0) {
    return <div className={styles.placeholder} aria-hidden="true" />;
  }

  const active = images[Math.min(activeIndex, images.length - 1)]!;

  return (
    <div className={styles.gallery}>
      <div className={styles.mainImageWrap}>
        {/* eslint-disable-next-line @next/next/no-img-element -- URL do Supabase Storage, sem remotePatterns configurado */}
        <img src={active.url} alt={alt} className={styles.mainImage} />
      </div>

      {images.length > 1 && (
        <div className={styles.thumbRow} role="tablist" aria-label="Outras fotos do produto">
          {images.map((image, index) => (
            <button
              key={image.id}
              type="button"
              role="tab"
              aria-selected={index === activeIndex}
              className={styles.thumb}
              data-active={index === activeIndex || undefined}
              onClick={() => setActiveIndex(index)}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- ver comentário acima */}
              <img src={image.url} alt="" loading="lazy" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
