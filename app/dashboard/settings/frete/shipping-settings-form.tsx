"use client";

import { useActionState, useRef, useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { Switch } from "@/components/ui/Switch";
import {
  centsToCurrencyInput,
  formatPostalCode,
  formatCityState,
  normalizePostalCode,
} from "@/lib/shipping/format";
import type { ShippingSettingsView } from "@/lib/shipping/service";
import { lookupOriginPostalCodeAction, saveShippingSettingsAction, type ShippingSettingsFormState } from "./actions";
import styles from "./shipping-settings.module.css";

const INITIAL: ShippingSettingsFormState = { status: "idle" };

/**
 * Valores de partida de uma loja que nunca configurou frete.
 *
 * São SUGESTÃO visível e editável, não regra: aparecem preenchidos para
 * o lojista pequeno não encarar três campos vazios sem referência, e só
 * viram configuração se ele clicar em salvar. Uma loja já configurada
 * nunca vê estes números — vê os dela.
 */
const SUGGESTED = { sameCity: "10,00", sameState: "20,00", otherState: "35,00" };

export function ShippingSettingsForm({
  storeSlug,
  settings,
  canEdit,
  /** Chegamos aqui pelo redirect de uma gravação bem-sucedida. */
  justSaved,
}: {
  storeSlug: string;
  settings: ShippingSettingsView;
  canEdit: boolean;
  justSaved?: boolean;
}) {
  const [state, formAction, pending] = useActionState(saveShippingSettingsAction, INITIAL);

  const [enabled, setEnabled] = useState(settings.enabled);
  const [freeShipping, setFreeShipping] = useState(settings.freeShippingEnabled);
  const [postalCode, setPostalCode] = useState(settings.originPostalCode ?? "");
  const [city, setCity] = useState(settings.originCity ?? "");
  const [uf, setUf] = useState(settings.originState ?? "");
  const [lookupState, setLookupState] = useState<"idle" | "loading" | "not_found" | "unavailable">("idle");
  const lastLookedUp = useRef(settings.originPostalCode ?? "");

  /**
   * Busca cidade/UF assim que o CEP fecha 8 dígitos — o lojista digita um
   * número e vê "Corumbá - MS" aparecer, que é a confirmação de que
   * acertou o CEP.
   *
   * Disparada do evento de digitação e não de um efeito, pelo mesmo
   * motivo do campo de CEP do checkout: um efeito observando o valor
   * chamaria setState em cascata a cada tecla.
   */
  const handlePostalCodeChange = (raw: string) => {
    const digits = normalizePostalCode(raw);
    setPostalCode(digits);

    if (digits.length !== 8) {
      lastLookedUp.current = "";
      setLookupState("idle");
      return;
    }
    if (lastLookedUp.current === digits) return;
    lastLookedUp.current = digits;

    setLookupState("loading");
    void lookupOriginPostalCodeAction(digits).then((result) => {
      if (result.status === "found") {
        setLookupState("idle");
        // Só preenche; nunca sobrescreve às cegas o que o lojista
        // corrigiu à mão depois — quem manda no valor final do frete é a
        // cidade/UF que ficarem salvas aqui.
        if (result.city) setCity(result.city);
        if (result.state) setUf(result.state);
        return;
      }
      setLookupState(result.status === "unavailable" ? "unavailable" : "not_found");
    });
  };

  const originLabel = formatCityState(city, uf);
  const initial = settings.isConfigured
    ? {
        sameCity: centsToCurrencyInput(settings.sameCityFeeCents),
        sameState: centsToCurrencyInput(settings.sameStateFeeCents),
        otherState: centsToCurrencyInput(settings.otherStateFeeCents),
      }
    : SUGGESTED;

  return (
    <form action={formAction} className={styles.form}>
      <input type="hidden" name="storeSlug" value={storeSlug} />

      {state.status === "error" && state.message && <Alert tone="danger">{state.message}</Alert>}
      {justSaved && state.status !== "error" && <Alert tone="success">Frete salvo.</Alert>}
      {!canEdit && (
        <Alert tone="info">
          Só proprietários e administradores podem alterar o frete. Você está vendo a configuração atual.
        </Alert>
      )}

      <Card>
        <CardHeader
          title="Entrega"
          description="Ligue para oferecer entrega com frete calculado pelo CEP do cliente. Desligado, sua loja continua aceitando pedidos para retirada."
        />
        <Switch
          name="enabled"
          checked={enabled}
          disabled={!canEdit}
          onChange={(event) => setEnabled(event.target.checked)}
          label={<span className={styles.switchLabel}>Oferecer entrega</span>}
        />
      </Card>

      {/* Entrega desligada esconde o resto da tela, mas os valores
          continuam viajando no formulário: sem isto, desligar a entrega e
          salvar zeraria a tabela de preços que o lojista já tinha
          configurado, e religar depois viria com tudo em R$ 0,00. */}
      {!enabled && (
        <>
          <input type="hidden" name="originPostalCode" value={postalCode} />
          <input type="hidden" name="originCity" value={city} />
          <input type="hidden" name="originState" value={uf} />
          <input type="hidden" name="sameCityFee" value={centsToCurrencyInput(settings.sameCityFeeCents)} />
          <input type="hidden" name="sameStateFee" value={centsToCurrencyInput(settings.sameStateFeeCents)} />
          <input type="hidden" name="otherStateFee" value={centsToCurrencyInput(settings.otherStateFeeCents)} />
          <input type="hidden" name="additionalFee" value={centsToCurrencyInput(settings.additionalFeeCents)} />
          {settings.freeShippingEnabled && <input type="hidden" name="freeShippingEnabled" value="on" />}
          {settings.freeShippingMinimumCents !== null && (
            <input
              type="hidden"
              name="freeShippingMinimum"
              value={centsToCurrencyInput(settings.freeShippingMinimumCents)}
            />
          )}
        </>
      )}

      {/* Todo o resto só existe se a entrega estiver ligada. Esconder em
          vez de desabilitar mantém a tela curta para quem só retira — que
          é a maioria das lojas pequenas no começo. */}
      {enabled && (
        <>
          <Card>
            <CardHeader
              title="De onde você envia"
              description="O CEP da loja define o ponto de partida. É a comparação entre a cidade dela e a do cliente que decide o valor."
            />

            <div className={styles.field}>
              <label htmlFor="originPostalCode" className={styles.label}>
                CEP da loja
              </label>
              <input
                id="originPostalCode"
                name="originPostalCode"
                className={styles.input}
                inputMode="numeric"
                maxLength={9}
                placeholder="79330-000"
                autoComplete="postal-code"
                disabled={!canEdit}
                value={formatPostalCode(postalCode)}
                onChange={(event) => handlePostalCodeChange(event.target.value)}
                aria-invalid={state.fieldErrors?.originPostalCode ? true : undefined}
                aria-describedby="originPostalCode-help"
              />
              <p id="originPostalCode-help" className={styles.help}>
                {lookupState === "loading"
                  ? "Buscando cidade…"
                  : lookupState === "not_found"
                    ? "Não encontramos esse CEP. Confira o número ou preencha cidade e estado abaixo."
                    : lookupState === "unavailable"
                      ? "A busca automática está indisponível agora — preencha cidade e estado abaixo."
                      : originLabel
                        ? `Sua loja envia de ${originLabel}.`
                        : "Vamos descobrir a cidade e o estado pelo CEP."}
              </p>
              {state.fieldErrors?.originPostalCode && (
                <p className={styles.fieldError}>{state.fieldErrors.originPostalCode}</p>
              )}
            </div>

            <div className={styles.grid}>
              <div className={styles.field}>
                <label htmlFor="originCity" className={styles.label}>
                  Cidade
                </label>
                <input
                  id="originCity"
                  name="originCity"
                  className={styles.input}
                  maxLength={120}
                  disabled={!canEdit}
                  value={city}
                  onChange={(event) => setCity(event.target.value)}
                  aria-invalid={state.fieldErrors?.originCity ? true : undefined}
                />
                {state.fieldErrors?.originCity && <p className={styles.fieldError}>{state.fieldErrors.originCity}</p>}
              </div>

              <div className={`${styles.field} ${styles.fieldNarrow}`}>
                <label htmlFor="originState" className={styles.label}>
                  Estado
                </label>
                <input
                  id="originState"
                  name="originState"
                  className={styles.input}
                  maxLength={2}
                  placeholder="MS"
                  autoCapitalize="characters"
                  disabled={!canEdit}
                  value={uf}
                  onChange={(event) => setUf(event.target.value.toUpperCase().slice(0, 2))}
                  aria-invalid={state.fieldErrors?.originState ? true : undefined}
                />
                {state.fieldErrors?.originState && <p className={styles.fieldError}>{state.fieldErrors.originState}</p>}
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Quanto você cobra"
              description="Três valores, comparando a cidade do cliente com a sua. É a regra inteira — sem peso, sem distância, sem tabela de transportadora."
            />

            <MoneyField
              id="sameCityFee"
              label={originLabel ? `Mesma cidade (${originLabel})` : "Mesma cidade"}
              help="Cliente na mesma cidade que a sua loja."
              defaultValue={initial.sameCity}
              disabled={!canEdit}
              error={state.fieldErrors?.sameCityFee}
            />
            <MoneyField
              id="sameStateFee"
              label={uf ? `Outras cidades de ${uf}` : "Outras cidades do mesmo estado"}
              help="Cliente no mesmo estado, em outra cidade."
              defaultValue={initial.sameState}
              disabled={!canEdit}
              error={state.fieldErrors?.sameStateFee}
            />
            <MoneyField
              id="otherStateFee"
              label="Outros estados"
              help="Qualquer cliente fora do seu estado."
              defaultValue={initial.otherState}
              disabled={!canEdit}
              error={state.fieldErrors?.otherStateFee}
            />
          </Card>

          <Card>
            <CardHeader title="Ajustes" description="Opcionais. Deixe como está se não precisar." />

            <MoneyField
              id="additionalFee"
              label="Acréscimo no frete"
              help="Somado a qualquer um dos três valores acima — embalagem, taxa da entrega, o que for. Não é cobrado quando o frete sai grátis."
              defaultValue={centsToCurrencyInput(settings.additionalFeeCents)}
              disabled={!canEdit}
              error={state.fieldErrors?.additionalFee}
            />

            <div className={styles.switchRow}>
              <Switch
                name="freeShippingEnabled"
                checked={freeShipping}
                disabled={!canEdit}
                onChange={(event) => setFreeShipping(event.target.checked)}
                label={<span className={styles.switchLabel}>Oferecer frete grátis acima de um valor</span>}
              />
            </div>

            {freeShipping && (
              <MoneyField
                id="freeShippingMinimum"
                label="Grátis em compras acima de"
                help="Contamos o valor dos produtos já com o desconto do cupom aplicado, antes do frete."
                defaultValue={
                  settings.freeShippingMinimumCents !== null
                    ? centsToCurrencyInput(settings.freeShippingMinimumCents)
                    : "200,00"
                }
                disabled={!canEdit}
                error={state.fieldErrors?.freeShippingMinimum}
              />
            )}
          </Card>
        </>
      )}

      {canEdit && (
        <div className={styles.actions}>
          <Button type="submit" size="lg" loading={pending}>
            Salvar alterações
          </Button>
        </div>
      )}
    </form>
  );
}

/**
 * Campo de dinheiro. O prefixo "R$" fica fora do input para o valor
 * digitado não precisar conviver com o símbolo, e `inputMode="decimal"`
 * abre o teclado numérico no celular — que é onde a maior parte dos
 * lojistas da CaraffaStore configura a loja.
 */
function MoneyField({
  id,
  label,
  help,
  defaultValue,
  disabled,
  error,
}: {
  id: string;
  label: string;
  help: string;
  defaultValue: string;
  disabled?: boolean;
  error?: string;
}) {
  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      <div className={styles.inputWithPrefix}>
        <span className={styles.affix} aria-hidden="true">
          R$
        </span>
        <input
          id={id}
          name={id}
          className={styles.input}
          inputMode="decimal"
          placeholder="0,00"
          defaultValue={defaultValue}
          disabled={disabled}
          aria-describedby={`${id}-help`}
          aria-invalid={error ? true : undefined}
        />
      </div>
      <p id={`${id}-help`} className={styles.help}>
        {help}
      </p>
      {error && <p className={styles.fieldError}>{error}</p>}
    </div>
  );
}
