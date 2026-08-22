"use server";

import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireStoreStatus } from "@/lib/tenant/access-control";
import { saveShippingSettings, ShippingError } from "@/lib/shipping/service";
import { currencyToCents, normalizePostalCode, normalizeState, isBrazilianState } from "@/lib/shipping/format";
import { merchantShippingMessage } from "@/lib/shipping/messages";
import { lookupPostalCode } from "@/lib/shipping/postal-code-lookup";

export interface ShippingSettingsFormState {
  status: "idle" | "error" | "success";
  message?: string;
  fieldErrors?: Record<string, string>;
}

/**
 * Converte um campo de dinheiro do formulário para centavos.
 *
 * Campo vazio vale zero — é o valor neutro e é o que o lojista espera de
 * "não cobro nada nessa faixa". Texto impossível ("abc", "-5") NÃO vira
 * zero em silêncio: vira erro de campo, senão o lojista salvaria uma
 * tabela de preços diferente da que digitou.
 */
function parseMoney(
  raw: string,
  field: string,
  fieldErrors: Record<string, string>,
  { optional = true }: { optional?: boolean } = {},
): number | null {
  const value = raw.trim();
  if (!value) {
    if (optional) return 0;
    fieldErrors[field] = "Informe um valor.";
    return null;
  }

  const cents = currencyToCents(value);
  if (cents === null) {
    fieldErrors[field] = "Use um valor como 10,00.";
    return null;
  }
  if (cents > 1_000_000) {
    fieldErrors[field] = "O limite por faixa é R$ 10.000,00.";
    return null;
  }
  return cents;
}

export async function saveShippingSettingsAction(
  _prev: ShippingSettingsFormState,
  formData: FormData,
): Promise<ShippingSettingsFormState> {
  const storeSlug = String(formData.get("storeSlug") ?? "");
  const enabled = String(formData.get("enabled") ?? "") === "on";
  const freeShippingEnabled = String(formData.get("freeShippingEnabled") ?? "") === "on";

  const fieldErrors: Record<string, string> = {};

  const originPostalCode = normalizePostalCode(String(formData.get("originPostalCode") ?? ""));
  let originCity = String(formData.get("originCity") ?? "").trim();
  let originState = normalizeState(String(formData.get("originState") ?? ""));

  const sameCity = parseMoney(String(formData.get("sameCityFee") ?? ""), "sameCityFee", fieldErrors);
  const sameState = parseMoney(String(formData.get("sameStateFee") ?? ""), "sameStateFee", fieldErrors);
  const otherState = parseMoney(String(formData.get("otherStateFee") ?? ""), "otherStateFee", fieldErrors);
  const additional = parseMoney(String(formData.get("additionalFee") ?? ""), "additionalFee", fieldErrors);

  let freeMinimum: number | null = null;
  if (freeShippingEnabled) {
    freeMinimum = parseMoney(String(formData.get("freeShippingMinimum") ?? ""), "freeShippingMinimum", fieldErrors, {
      optional: false,
    });
    if (freeMinimum !== null && freeMinimum <= 0) {
      fieldErrors.freeShippingMinimum = "Informe um valor maior que zero.";
    }
  }

  if (enabled) {
    if (originPostalCode.length !== 8) {
      fieldErrors.originPostalCode = "Informe o CEP da loja, com 8 dígitos.";
    }
    if (originState && !isBrazilianState(originState)) {
      fieldErrors.originState = "Informe uma sigla de estado válida, como MS.";
    }
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { status: "error", fieldErrors };
  }

  /**
   * Cidade/UF em branco com CEP válido: resolve pelo próprio servidor em
   * vez de recusar. O lojista que digitou o CEP e não esperou a busca
   * automática terminar (ou está com a busca fora do ar e não sabe a
   * grafia exata) não deveria ficar preso — e a grafia que a base do CEP
   * devolve é justamente a que combina com o que o comprador vai
   * receber no checkout, o que reduz divergência de cidade entre as duas
   * pontas.
   */
  if (enabled && (!originCity || !originState)) {
    const lookup = await lookupPostalCode(originPostalCode);
    if (lookup.status === "found") {
      originCity = originCity || lookup.address.city || "";
      originState = originState || lookup.address.state || "";
    }
  }

  if (enabled && (!originCity || !originState)) {
    const missing: Record<string, string> = {};
    if (!originCity) missing.originCity = "Informe a cidade da loja.";
    if (!originState) missing.originState = "Informe o estado da loja.";
    return {
      status: "error",
      fieldErrors: missing,
      message: "Não conseguimos descobrir a cidade pelo CEP agora. Preencha cidade e estado à mão.",
    };
  }

  const supabase = await createServerSupabaseClient();
  const { store, role } = await requireStoreStatus(supabase, "active", storeSlug);

  /**
   * shipping_settings_upsert já reautoriza no banco
   * (can_manage_store_catalog: owner/admin + loja active + sessão viva).
   * O redirect aqui é só para o staff não gastar um POST e receber um
   * erro cru — a barreira real continua sendo a do banco.
   */
  if (role !== "owner" && role !== "admin") {
    redirect(`/dashboard?store=${store.slug}`);
  }

  try {
    await saveShippingSettings(supabase, store.id, {
      enabled,
      originPostalCode: originPostalCode || null,
      originCity: originCity || null,
      originState: originState || null,
      sameCityFeeCents: sameCity ?? 0,
      sameStateFeeCents: sameState ?? 0,
      otherStateFeeCents: otherState ?? 0,
      additionalFeeCents: additional ?? 0,
      freeShippingEnabled,
      freeShippingMinimumCents: freeMinimum,
    });
  } catch (error) {
    const code = error instanceof ShippingError ? error.code : "unknown_error";
    return { status: "error", message: merchantShippingMessage(code) };
  }

  /**
   * Redireciona em vez de devolver `{ status: "success" }` — mesmo padrão
   * de savePaymentSettingsAction, e aqui por um motivo concreto: o React
   * reseta os campos não controlados de um `<form action={...}>` depois
   * que a action termina. Sem recarregar a página, os campos voltariam
   * para os valores que vieram do servidor no carregamento anterior, e o
   * lojista veria "R$ 0,00" logo depois de salvar "R$ 5,00" — parecendo
   * que a gravação falhou quando ela funcionou.
   *
   * O redirect precisa ficar FORA do try: redirect() sinaliza por
   * exceção, e um catch em volta a engoliria.
   */
  redirect(`/dashboard/settings/frete?store=${store.slug}&salvo=1`);
}

/**
 * Busca cidade/UF do CEP da loja enquanto o lojista digita — mesma
 * função do checkout, mesmo tratamento de indisponibilidade.
 */
export async function lookupOriginPostalCodeAction(
  rawPostalCode: string,
): Promise<{ status: string; city: string | null; state: string | null }> {
  const result = await lookupPostalCode(String(rawPostalCode ?? ""));
  if (result.status !== "found") {
    return { status: result.status, city: null, state: null };
  }
  return { status: "found", city: result.address.city, state: result.address.state };
}
