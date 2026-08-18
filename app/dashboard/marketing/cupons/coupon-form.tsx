"use client";

import { useActionState, useState } from "react";
import { saveCouponAction, toggleCouponAction, type CouponFormState } from "./actions";
import { Alert } from "@/components/ui/Alert";
import styles from "./coupons.module.css";

const INITIAL: CouponFormState = { status: "idle" };

export function CouponForm() {
  const [state, formAction, pending] = useActionState(saveCouponAction, INITIAL);
  const [type, setType] = useState<"percentage" | "fixed_amount">("percentage");

  return (
    <form action={formAction} className={styles.form}>
      {state.status === "error" && state.message && <Alert tone="danger">{state.message}</Alert>}
      {state.status === "success" && state.message && <Alert tone="success">{state.message}</Alert>}

      <div className={styles.field}>
        <label htmlFor="coupon-code" className={styles.label}>
          Código
        </label>
        <input
          id="coupon-code"
          name="code"
          required
          maxLength={32}
          autoComplete="off"
          placeholder="NATAL10"
          className={`${styles.input} ${styles.codeInput}`}
          aria-describedby="coupon-code-help"
          aria-invalid={state.fieldErrors?.code ? true : undefined}
        />
        <p id="coupon-code-help" className={styles.help}>
          Não diferencia maiúsculas de minúsculas — seu cliente pode digitar de qualquer forma.
        </p>
        {state.fieldErrors?.code && <p className={styles.fieldError}>{state.fieldErrors.code}</p>}
      </div>

      <fieldset className={styles.fieldset}>
        <legend className={styles.label}>Tipo de desconto</legend>
        <div className={styles.radioRow}>
          <label className={styles.radio}>
            <input
              type="radio"
              name="discountType"
              value="percentage"
              checked={type === "percentage"}
              onChange={() => setType("percentage")}
            />
            Percentual
          </label>
          <label className={styles.radio}>
            <input
              type="radio"
              name="discountType"
              value="fixed_amount"
              checked={type === "fixed_amount"}
              onChange={() => setType("fixed_amount")}
            />
            Valor fixo
          </label>
        </div>
      </fieldset>

      <div className={styles.field}>
        <label htmlFor="coupon-value" className={styles.label}>
          {type === "percentage" ? "Percentual de desconto" : "Valor do desconto"}
        </label>
        <div className={styles.inputWithSuffix}>
          {type === "fixed_amount" && <span className={styles.affix}>R$</span>}
          <input
            id="coupon-value"
            name="discountValue"
            required
            inputMode="decimal"
            placeholder={type === "percentage" ? "10" : "20,00"}
            className={styles.input}
            aria-invalid={state.fieldErrors?.discountValue ? true : undefined}
          />
          {type === "percentage" && <span className={styles.affix}>%</span>}
        </div>
        {state.fieldErrors?.discountValue && (
          <p className={styles.fieldError}>{state.fieldErrors.discountValue}</p>
        )}
      </div>

      <div className={styles.grid}>
        <div className={styles.field}>
          <label htmlFor="coupon-min" className={styles.label}>
            Pedido mínimo <span className={styles.optional}>(opcional)</span>
          </label>
          <div className={styles.inputWithSuffix}>
            <span className={styles.affix}>R$</span>
            <input id="coupon-min" name="minimumOrder" inputMode="decimal" placeholder="100,00" className={styles.input} />
          </div>
          {state.fieldErrors?.minimumOrder && (
            <p className={styles.fieldError}>{state.fieldErrors.minimumOrder}</p>
          )}
        </div>

        {/* Desconto máximo só faz sentido em percentual — num valor fixo o
            teto seria o próprio valor. O backend rejeita a combinação. */}
        {type === "percentage" && (
          <div className={styles.field}>
            <label htmlFor="coupon-max" className={styles.label}>
              Desconto máximo <span className={styles.optional}>(opcional)</span>
            </label>
            <div className={styles.inputWithSuffix}>
              <span className={styles.affix}>R$</span>
              <input id="coupon-max" name="maximumDiscount" inputMode="decimal" placeholder="50,00" className={styles.input} />
            </div>
            {state.fieldErrors?.maximumDiscount && (
              <p className={styles.fieldError}>{state.fieldErrors.maximumDiscount}</p>
            )}
          </div>
        )}
      </div>

      <div className={styles.grid}>
        <div className={styles.field}>
          <label htmlFor="coupon-start" className={styles.label}>
            Início <span className={styles.optional}>(opcional)</span>
          </label>
          <input id="coupon-start" name="startsAt" type="date" className={styles.input} />
        </div>
        <div className={styles.field}>
          <label htmlFor="coupon-end" className={styles.label}>
            Expiração <span className={styles.optional}>(opcional)</span>
          </label>
          <input id="coupon-end" name="expiresAt" type="date" className={styles.input} />
          <p className={styles.help}>Vale até o fim do dia escolhido.</p>
          {state.fieldErrors?.expiresAt && <p className={styles.fieldError}>{state.fieldErrors.expiresAt}</p>}
        </div>
      </div>

      <div className={styles.field}>
        <label htmlFor="coupon-uses" className={styles.label}>
          Limite de utilizações <span className={styles.optional}>(opcional)</span>
        </label>
        <input
          id="coupon-uses"
          name="maxUses"
          type="number"
          min={1}
          inputMode="numeric"
          placeholder="Sem limite"
          className={styles.input}
        />
        {state.fieldErrors?.maxUses && <p className={styles.fieldError}>{state.fieldErrors.maxUses}</p>}
      </div>

      <label className={styles.checkbox}>
        <input type="checkbox" name="active" defaultChecked />
        Ativar imediatamente
      </label>

      <button type="submit" className={styles.primary} disabled={pending}>
        {pending ? "Salvando…" : "Criar cupom"}
      </button>
    </form>
  );
}

export function ToggleCouponForm({
  coupon,
}: {
  coupon: {
    id: string;
    code: string;
    discountType: string;
    discountValue: number;
    minimumOrderCents: number | null;
    maximumDiscountCents: number | null;
    startsAt: string | null;
    expiresAt: string | null;
    maxUses: number | null;
    active: boolean;
  };
}) {
  const [state, formAction, pending] = useActionState(toggleCouponAction, INITIAL);

  return (
    <form action={formAction} className={styles.toggleForm}>
      <input type="hidden" name="couponId" value={coupon.id} />
      <input type="hidden" name="code" value={coupon.code} />
      <input type="hidden" name="discountType" value={coupon.discountType} />
      <input type="hidden" name="discountValue" value={coupon.discountValue} />
      <input type="hidden" name="minimumOrderCents" value={coupon.minimumOrderCents ?? ""} />
      <input type="hidden" name="maximumDiscountCents" value={coupon.maximumDiscountCents ?? ""} />
      <input type="hidden" name="startsAt" value={coupon.startsAt ?? ""} />
      <input type="hidden" name="expiresAt" value={coupon.expiresAt ?? ""} />
      <input type="hidden" name="maxUses" value={coupon.maxUses ?? ""} />
      <input type="hidden" name="nextActive" value={coupon.active ? "false" : "true"} />
      <button type="submit" className={styles.secondary} disabled={pending}>
        {pending ? "…" : coupon.active ? "Desativar" : "Ativar"}
      </button>
      {state.status === "error" && <span className={styles.inlineError}>{state.message}</span>}
    </form>
  );
}
