import { normalizePostalCode } from "./format";

/**
 * Consulta de CEP.
 *
 * Por que no SERVIDOR e não no navegador: uma chamada direta do
 * navegador a um host externo depende de CORS de terceiro, aparece nas
 * ferramentas de rede do comprador e some junto com qualquer bloqueio de
 * rede local. Feita aqui, o checkout tem um único ponto para tratar
 * indisponibilidade — e é isso que permite a regra da tarefa: o
 * checkout NUNCA fica inutilizável se o serviço de CEP cair.
 *
 * O que este módulo devolve é SUGESTÃO DE PREENCHIMENTO, nunca preço. O
 * frete é decidido no banco a partir da cidade/UF que forem realmente
 * enviadas no pedido — o comprador pode corrigir qualquer campo, e a
 * conta segue o que ele confirmou.
 *
 * ViaCEP foi escolhido por ser gratuito, sem cadastro nem chave, e já
 * ser o padrão de fato em e-commerce brasileiro. Nenhuma dependência
 * nova entra no projeto: é um fetch.
 */

const VIACEP_ENDPOINT = "https://viacep.com.br/ws";
const LOOKUP_TIMEOUT_MS = 4000;

export interface PostalCodeAddress {
  postalCode: string;
  street: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
}

export type PostalCodeLookup =
  | { status: "found"; address: PostalCodeAddress }
  /** CEP bem formado, mas que não existe na base. */
  | { status: "not_found" }
  /** Menos de 8 dígitos — nem chegamos a consultar. */
  | { status: "invalid" }
  /** Serviço fora do ar, lento ou respondendo besteira. O checkout segue à mão. */
  | { status: "unavailable" };

interface ViaCepPayload {
  cep?: unknown;
  logradouro?: unknown;
  bairro?: unknown;
  localidade?: unknown;
  uf?: unknown;
  erro?: unknown;
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Separada do fetch de propósito: é aqui que mora todo o comportamento
 * interessante (CEP inexistente, resposta truncada, cidade/UF ausentes),
 * e é isso que os testes exercitam sem tocar na rede.
 *
 * ViaCEP sinaliza CEP inexistente com `{"erro": "true"}` — às vezes
 * string, às vezes booleano, dependendo da versão da resposta. Os dois
 * são tratados.
 */
export function parseViaCepPayload(payload: unknown, requestedPostalCode: string): PostalCodeLookup {
  if (typeof payload !== "object" || payload === null) {
    return { status: "unavailable" };
  }

  const body = payload as ViaCepPayload;
  if (body.erro === true || body.erro === "true") {
    return { status: "not_found" };
  }

  const city = text(body.localidade);
  const state = text(body.uf);

  // Um CEP sem cidade/UF é inútil para frete: sem esse par não há faixa
  // a aplicar. Tratado como "não encontrado" para o comprador cair no
  // preenchimento manual em vez de seguir com um endereço mudo.
  if (!city || !state) {
    return { status: "not_found" };
  }

  return {
    status: "found",
    address: {
      postalCode: normalizePostalCode(text(body.cep) ?? requestedPostalCode),
      street: text(body.logradouro),
      neighborhood: text(body.bairro),
      city,
      state: state.toUpperCase(),
    },
  };
}

/**
 * `fetchImpl` é injetável só para teste. Em produção é o fetch global do
 * Node/Next.
 */
export async function lookupPostalCode(
  rawPostalCode: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PostalCodeLookup> {
  const postalCode = normalizePostalCode(rawPostalCode);
  if (postalCode.length !== 8) {
    return { status: "invalid" };
  }

  try {
    const response = await fetchImpl(`${VIACEP_ENDPOINT}/${postalCode}/json/`, {
      // Sem cache do Next: o custo é uma chamada curta, e um CEP
      // corrigido pelo comprador precisa refletir na hora.
      cache: "no-store",
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    });

    if (!response.ok) {
      // 400 do ViaCEP significa CEP mal formado; qualquer outro código é
      // problema do serviço, não do comprador.
      return response.status === 400 ? { status: "invalid" } : { status: "unavailable" };
    }

    return parseViaCepPayload(await response.json(), postalCode);
  } catch {
    // Timeout, DNS, TLS, JSON quebrado — tudo cai aqui e vira
    // "preencha à mão", nunca um checkout travado.
    return { status: "unavailable" };
  }
}
