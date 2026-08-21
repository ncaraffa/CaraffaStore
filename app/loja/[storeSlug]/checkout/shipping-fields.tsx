"use client";

import { useCallback, useRef, useState } from "react";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { formatPostalCode, isCompletePostalCode, normalizePostalCode } from "@/lib/shipping/format";
import { quoteMessage } from "@/lib/shipping/messages";
import { lookupPostalCodeAction } from "./shipping-actions";
import styles from "./checkout.module.css";

/**
 * Estado local do endereço.
 *
 * `city` e `state` estão aqui só para EXIBIÇÃO — são o que o servidor
 * respondeu ao resolver o CEP. Não existe input com esses nomes, então
 * não são enviados no formulário, e create_order nem aceita esses
 * parâmetros: quem decide a cidade que define a faixa de frete é o
 * banco, a partir do CEP.
 */
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
 * O que a pessoa preenche: CEP, rua, número, complemento e bairro.
 * Nenhum desses últimos quatro entra em conta nenhuma — servem para o
 * comerciante entregar. O CEP é o único campo com efeito financeiro, e
 * mesmo ele só como chave: o valor sai da configuração da loja.
 *
 * Rua e bairro chegam preenchidos pela busca de CEP e continuam
 * editáveis, porque endereço real tem exceção (loteamento novo,
 * logradouro renomeado) e travar o campo transformaria um acerto de 95%
 * num beco sem saída nos outros 5%.
 *
 * Cidade e UF, ao contrário, aparecem como TEXTO. Elas decidem a faixa
 * de frete; deixá-las editáveis seria deixar o comprador escolher quanto
 * quer pagar.
 */
export function ShippingFields({
  address,
  onChange,
  fieldErrors,
  /**
   * Destino confirmado pelo servidor ("São Paulo - SP"). Vem da cotação
   * quando ela já chegou — é literalmente o par que decidiu o preço.
   */
  destination,
}: {
  address: ShippingAddressState;
  onChange: (next: ShippingAddressState) => void;
  fieldErrors?: Record<string, string>;
  destination: string | null;
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
          city: result.city ?? "",
          state: result.state ?? "",
        });
        return;
      }

      // Destino não confirmado: limpa cidade/UF para a tela não sugerir
      // um destino que o cálculo não vai usar.
      setLookupState(result.status === "not_found" || result.status === "invalid" ? "not_found" : "unavailable");
      onChange({ ...current, postalCode: digits, city: "", state: "" });
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

    if (digits.length !== 8) {
      lastLookedUp.current = "";
      setLookupState("idle");
      // CEP incompleto ou longo demais: não há destino confirmado.
      onChange({ ...next, city: "", state: "" });
      return;
    }

    onChange(next);
    void runLookup(digits, next);
  };

  const set = (patch: Partial<ShippingAddressState>) => onChange({ ...address, ...patch });

  const digits = normalizePostalCode(address.postalCode);
  const tooManyDigits = digits.length > 8;

  const lookupHint = tooManyDigits
    ? "O CEP tem 8 dígitos — confira o que foi colado."
    : lookupState === "loading"
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
          aria-invalid={Boolean(fieldErrors?.shippingPostalCode) || tooManyDigits || undefined}
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

      {/*
        Cidade e UF são MOSTRADAS, não perguntadas — ver o comentário do
        componente. É o destino que o servidor confirmou pelo CEP e que
        vai decidir o valor cobrado.
      */}
      <div className={styles.resolvedDestination}>
        <span className={styles.resolvedLabel}>Cidade de entrega</span>
        {destination ? (
          <strong className={styles.resolvedValue}>{destination}</strong>
        ) : (
          <span className={styles.resolvedPending}>
            {lookupState === "loading"
              ? "Confirmando pelo CEP…"
              : isCompletePostalCode(address.postalCode)
                ? "Não foi possível confirmar pelo CEP"
                : "Informe o CEP para confirmarmos"}
          </span>
        )}
      </div>
    </>
  );
}
