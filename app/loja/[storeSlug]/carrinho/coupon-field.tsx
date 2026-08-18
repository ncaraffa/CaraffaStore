"use client";

import { useActionState, useEffect, useRef } from "react";
import { previewCouponAction, type CouponPreviewState } from "./coupon-actions";
import { readAppliedCoupon, writeAppliedCoupon } from "@/lib/cart/coupon-storage";
import { formatPriceCents } from "@/lib/catalog/format";
import styles from "./coupon-field.module.css";

const INITIAL: CouponPreviewState = { status: "idle" };

/**
 * Campo de cupom do carrinho.
 *
 * Persiste apenas o CÓDIGO (lib/cart/coupon-storage). O desconto exibido
 * é sempre resultado de uma prévia recalculada no servidor, e o valor
 * final do pedido é recalculado de novo no banco no checkout — o que
 * está na tela é informação, nunca a fonte financeira.
 *
 * Revalida quando o subtotal muda: se o comprador remover um item e o
 * pedido cair abaixo do mínimo, o desconto tem que sumir da tela em vez
 * de continuar prometendo algo que o checkout vai recusar.
 */
export function CouponField({
  storeSlug,
  subtotalCents,
}: {
  storeSlug: string;
  subtotalCents: number;
}) {
  const [state, formAction, pending] = useActionState(previewCouponAction, INITIAL);
  const formRef = useRef<HTMLFormElement>(null);
  const lastSubtotal = useRef(subtotalCents);

  // Reaplica o cupom guardado ao abrir o carrinho.
  useEffect(() => {
    const saved = readAppliedCoupon(storeSlug);
    if (saved && state.status === "idle" && subtotalCents > 0) {
      const form = formRef.current;
      if (form) {
        (form.elements.namedItem("code") as HTMLInputElement).value = saved;
        form.requestSubmit();
      }
    }
    // Intencionalmente só na montagem: reenvio a cada render viraria loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeSlug]);

  // Carrinho mudou de valor -> a prévia anterior pode ter deixado de valer.
  useEffect(() => {
    if (lastSubtotal.current === subtotalCents) return;
    lastSubtotal.current = subtotalCents;

    if (state.status === "applied" && state.code) {
      const form = formRef.current;
      if (form && subtotalCents > 0) form.requestSubmit();
    }
  }, [subtotalCents, state.status, state.code]);

  // Guarda/limpa o código conforme o resultado da prévia.
  useEffect(() => {
    if (state.status === "applied" && state.code) {
      writeAppliedCoupon(storeSlug, state.code);
    } else if (state.status === "error") {
      writeAppliedCoupon(storeSlug, null);
    }
  }, [state.status, state.code, storeSlug]);

  const applied = state.status === "applied" && state.code;

  return (
    <div className={styles.wrapper}>
      <form ref={formRef} action={formAction} className={styles.form}>
        <input type="hidden" name="storeSlug" value={storeSlug} />
        <input type="hidden" name="subtotalCents" value={subtotalCents} />

        <label htmlFor="coupon-code-field" className={styles.label}>
          Cupom de desconto
        </label>
        <div className={styles.row}>
          <input
            id="coupon-code-field"
            name="code"
            className={styles.input}
            placeholder="NATAL10"
            autoComplete="off"
            autoCapitalize="characters"
            maxLength={32}
            defaultValue={state.code ?? ""}
            aria-describedby={state.status === "error" ? "coupon-field-error" : undefined}
            aria-invalid={state.status === "error" ? true : undefined}
          />
          <button type="submit" className={styles.apply} disabled={pending || subtotalCents <= 0}>
            {pending ? "…" : "Aplicar"}
          </button>
        </div>
      </form>

      {state.status === "error" && state.message && (
        <p id="coupon-field-error" className={styles.error} role="status">
          {state.message}
        </p>
      )}

      {applied && (
        <div className={styles.applied} role="status">
          <span className={styles.appliedText}>
            <strong>{state.code}</strong> aplicado · −{formatPriceCents(state.discountCents ?? 0)}
          </span>
          <button
            type="button"
            className={styles.remove}
            onClick={() => {
              writeAppliedCoupon(storeSlug, null);
              // Recarrega para o resumo voltar ao valor sem desconto — o
              // total exibido volta a ser o subtotal puro.
              window.location.reload();
            }}
          >
            Remover
          </button>
        </div>
      )}
    </div>
  );
}
