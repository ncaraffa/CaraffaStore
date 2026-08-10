"use client";

import { useEffect } from "react";

/**
 * Motor de scroll reveal da página.
 *
 * Um único IntersectionObserver para todos os `[data-reveal]` do documento,
 * em vez de um componente cliente (e um observer) por elemento. Isso mantém
 * as seções como Server Components — o único JS enviado ao navegador é este
 * arquivo — e evita listener de scroll, que é a causa clássica de jank em
 * celular. Cada alvo é desobservado assim que aparece.
 *
 * O reveal esconde conteúdo até liberá-lo, então ele precisa de rede de
 * segurança em três camadas — uma página em branco é falha muito pior do que
 * uma animação perdida:
 *
 *  1. O que já está na viewport é liberado na montagem, sem depender de
 *     callback nenhum (o topo da página nunca fica esperando o observer).
 *  2. Se o observer não devolver nada em 1,2s — aba em segundo plano no
 *     load, navegador que suspende o ciclo de render, ambiente headless —
 *     tudo é liberado de uma vez.
 *  3. `prefers-reduced-motion` libera tudo imediatamente.
 */
const REVEAL_SELECTOR = "[data-reveal]:not([data-revealed])";
const FALLBACK_MS = 1200;

export function RevealRoot() {
  useEffect(() => {
    const targets = Array.from(document.querySelectorAll<HTMLElement>(REVEAL_SELECTOR));
    if (targets.length === 0) return;

    const reveal = (el: Element) => el.setAttribute("data-revealed", "");
    const revealAll = () => targets.forEach(reveal);

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      revealAll();
      return;
    }

    // 1. Acima da dobra entra já — a transição roda porque o atributo é
    //    aplicado depois da primeira pintura.
    const fold = window.innerHeight * 0.92;
    const pending: HTMLElement[] = [];
    for (const el of targets) {
      if (el.getBoundingClientRect().top < fold) reveal(el);
      else pending.push(el);
    }

    let observerResponded = false;
    const observer = new IntersectionObserver(
      (entries) => {
        observerResponded = true;
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          reveal(entry.target);
          observer.unobserve(entry.target);
        }
      },
      // Dispara um pouco antes de encostar na borda: o elemento já chega
      // em movimento em vez de "pular" depois de visível.
      { rootMargin: "0px 0px -12% 0px", threshold: 0.01 },
    );

    pending.forEach((el) => observer.observe(el));

    // 2. Rede de segurança: observer mudo significa conteúdo invisível.
    const fallback = window.setTimeout(() => {
      if (observerResponded) return;
      observer.disconnect();
      revealAll();
    }, FALLBACK_MS);

    return () => {
      window.clearTimeout(fallback);
      observer.disconnect();
    };
  }, []);

  return null;
}
