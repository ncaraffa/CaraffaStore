"use client";

import { useCallback, useRef, useState } from "react";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { formatPostalCode, isCompletePostalCode, normalizePostalCode } from "@/lib/shipping/format";
import { quoteMessage } from "@/lib/shipping/messages";
import { lookupPostalCodeAction } from "./shipping-actions";
import styles from "./checkout.module.css";

export interface ShippingAddressState {
  postalCode: string;
  street: string;
  number: string;
  complement: string;
  neighborhood: string;
  city: string;
  state: string;
}

export const EMPTY_SHIPPING_ADDRESS: ShippingAddressState = {
  postalCode: "",
  street: "",
  number: "",
  complement: "",
  neighborhood: "",
  city: "",
  state: "",
};

/**
 * Endereço de entrega do checkout.
 *
 * Duas decisões que a tarefa pede explicitamente e que valem comentário:
 *
 * 1. Nenhum campo trazido pela busca de CEP fica bloqueado. O que a API
 *    devolve é sugestão — endereço real tem exceção (loteamento novo,
 *    logradouro renomeado, CEP único de cidade pequena), e travar o
 *    campo transformaria um acerto de 95% num beco sem saída nos outros
 *    5%.
 *
 * 2. Se a busca falhar, o formulário continua inteiro e utilizável. O
 *    CEP permanece obrigatório porque é ele que identifica o destino no
 *    pedido, mas cidade/UF podem ser digitadas — e é a cidade/UF que
 *    vira faixa de frete no banco, então o pedido continua calculável.
 */
export function ShippingFields({
  address,
  onChange,
  fieldErrors,
}: {
  address: ShippingAddressState;
  onChange: (next: ShippingAddressState) => void;
  fieldErrors?: Record<string, string>;
}) {
  const [lookupState, setLookupState] = useState<"idle" | "loading" | "not_found" | "unavailable" | "found">("idle");
  // Guarda o último CEP consultado para não repetir a chamada a cada
  // tecla depois que os 8 dígitos já foram completados.
  const lastLookedUp = useRef<string>("");

  const runLookup = useCallback(
    async (digits: string, current: ShippingAddressState) => {
      if (lastLookedUp.current === digits) return;
      lastLookedUp.current = digits;
      setLookupState("loading");

      const result = await lookupPostalCodeAction(digits);

      if (result.status === "found") {
        setLookupState("found");
        onChange({
          ...current,
          postalCode: digits,
          // Só preenche o que veio; nunca apaga o que a pessoa já
          // escreveu à mão num campo que a API não conhece.
          street: result.street ?? current.street,
          neighborhood: result.neighborhood ?? current.neighborhood,
          city: result.city ?? current.city,
          state: result.state ?? current.state,
        });
        return;
      }

      setLookupState(result.status === "not_found" || result.status === "invalid" ? "not_found" : "unavailable");
    },
    [onChange],
  );

  /**
   * A busca dispara ao completar 8 dígitos, direto do evento de digitação
   * — e não de um efeito observando o valor. É o mesmo comportamento
   * visível (digitou o CEP, o endereço aparece), com uma diferença que
   * importa: um efeito que chama setState em cascata a cada tecla é
   * exatamente o que a regra react-hooks/set-state-in-effect existe para
   * impedir, além de reagir a mudanças que não vieram da pessoa.
   */
  const handlePostalCodeChange = (raw: string) => {
    const digits = normalizePostalCode(raw);
    const next = { ...address, postalCode: digits };
    onChange(next);

    if (digits.length < 8) {
      lastLookedUp.current = "";
      setLookupState("idle");
      return;
    }
    void runLookup(digits, next);
  };

  const set = (patch: Partial<ShippingAddressState>) => onChange({ ...address, ...patch });

  const lookupHint =
    lookupState === "loading"
      ? "Buscando endereço…"
      : lookupState === "not_found"
        ? quoteMessage("postal_code_not_found")
        : lookupState === "unavailable"
          ? quoteMessage("lookup_unavailable")
          : undefined;

  return (
    <>
      <Field
        label="CEP"
        htmlFor="shippingPostalCode"
        required
        error={fieldErrors?.shippingPostalCode}
        hint={lookupHint}
        info="Usamos o CEP para calcular o frete até você e para o comerciante saber onde entregar."
      >
        <Input
          id="shippingPostalCode"
          name="shippingPostalCode"
          required
          // inputMode numeric abre o teclado de números no celular; o
          // maxLength conta a máscara (00000-000), não os dígitos.
          inputMode="numeric"
          autoComplete="postal-code"
          maxLength={9}
          placeholder="79002-000"
          value={formatPostalCode(address.postalCode)}
          onChange={(event) => handlePostalCodeChange(event.target.value)}
          aria-invalid={Boolean(fieldErrors?.shippingPostalCode)}
          aria-busy={lookupState === "loading" || undefined}
        />
      </Field>

      <div className={styles.addressGrid}>
        <div className={styles.addressStreet}>
          <Field label="Rua" htmlFor="shippingStreet" required error={fieldErrors?.shippingStreet}>
            <Input
              id="shippingStreet"
              name="shippingStreet"
              required
              maxLength={200}
              autoComplete="address-line1"
              value={address.street}
              onChange={(event) => set({ street: event.target.value })}
              aria-invalid={Boolean(fieldErrors?.shippingStreet)}
            />
          </Field>
        </div>

        <div className={styles.addressNumber}>
          <Field label="Número" htmlFor="shippingNumber" required error={fieldErrors?.shippingNumber}>
            <Input
              id="shippingNumber"
              name="shippingNumber"
              required
              maxLength={20}
              inputMode="numeric"
              placeholder="123"
              value={address.number}
              onChange={(event) => set({ number: event.target.value })}
              aria-invalid={Boolean(fieldErrors?.shippingNumber)}
            />
          </Field>
        </div>
      </div>

      <Field label="Complemento (opcional)" htmlFor="shippingComplement" error={fieldErrors?.shippingComplement}>
        <Input
          id="shippingComplement"
          name="shippingComplement"
          maxLength={100}
          placeholder="Apto 10"
          autoComplete="address-line2"
          value={address.complement}
          onChange={(event) => set({ complement: event.target.value })}
        />
      </Field>

      <Field label="Bairro" htmlFor="shippingNeighborhood" error={fieldErrors?.shippingNeighborhood}>
        <Input
          id="shippingNeighborhood"
          name="shippingNeighborhood"
          maxLength={120}
          value={address.neighborhood}
          onChange={(event) => set({ neighborhood: event.target.value })}
        />
      </Field>

      <div className={styles.addressGrid}>
        <div className={styles.addressStreet}>
          <Field label="Cidade" htmlFor="shippingCity" required error={fieldErrors?.shippingCity}>
            <Input
              id="shippingCity"
              name="shippingCity"
              required
              maxLength={120}
              autoComplete="address-level2"
              value={address.city}
              onChange={(event) => set({ city: event.target.value })}
              aria-invalid={Boolean(fieldErrors?.shippingCity)}
            />
          </Field>
        </div>

        <div className={styles.addressNumber}>
          <Field label="Estado" htmlFor="shippingState" required error={fieldErrors?.shippingState}>
            <Input
              id="shippingState"
              name="shippingState"
              required
              maxLength={2}
              placeholder="MS"
              autoComplete="address-level1"
              autoCapitalize="characters"
              value={address.state}
              onChange={(event) => set({ state: event.target.value.toUpperCase().slice(0, 2) })}
              aria-invalid={Boolean(fieldErrors?.shippingState)}
            />
          </Field>
        </div>
      </div>

      {!isCompletePostalCode(address.postalCode) && (
        <p className={styles.shippingHint}>Informe o CEP para calcularmos o frete.</p>
      )}
    </>
  );
}
