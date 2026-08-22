import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { getPublicSupabaseEnv, getServiceRoleEnv } from "@/lib/supabase/env";
import { lookupPostalCode, type PostalCodeLookup } from "@/lib/shipping/postal-code-lookup";

/**
 * A única porta por onde cidade e UF de um CEP entram no banco.
 *
 * POR QUE ISTO EXISTE
 *
 * A faixa de frete é decidida comparando a cidade/UF do destino com a da
 * loja. Se esse par viesse do navegador, bastaria interceptar a
 * requisição do checkout e enviar a cidade da própria loja para pagar
 * sempre a faixa mais barata — CEP de São Paulo cobrado como se fosse
 * entrega no mesmo bairro.
 *
 * O Postgres não faz chamada de rede, então não consegue conferir o CEP
 * sozinho. A saída é estreitar a porta: quem escreve em
 * shipping_postal_codes é `service_role`, e só depois de uma resposta
 * REAL do serviço de CEP. O checkout público lê o destino de lá
 * (shipping_resolve_destination) e ignora por completo o que o
 * formulário disse — a cidade digitada não é sequer parâmetro de
 * create_order.
 *
 * Mesmo desenho de lib/payments/service-only/*: um fato que o banco não
 * pode verificar por conta própria entra por uma RPC service_role
 * dedicada, nunca por parâmetro de função pública.
 *
 * Cliente próprio, deliberadamente NÃO a fábrica administrativa genérica
 * (arquivo "admin", pasta "supabase" — reservada a scripts de seed e
 * manutenção desde BUG-T2-004, e proibida em código que responde a
 * requisição de usuário). A guarda estática que garante isso vive no
 * teste "admin-usage" ao lado daquela fábrica, e é uma busca textual:
 * citar o caminho dela aqui, mesmo dentro de um comentário, faria o
 * teste acusar este arquivo.
 */
function createShippingServiceClient() {
  const { NEXT_PUBLIC_SUPABASE_URL } = getPublicSupabaseEnv();
  const { SUPABASE_SERVICE_ROLE_KEY } = getServiceRoleEnv();

  return createClient<Database>(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Consulta o CEP no serviço externo e, quando encontra, registra o
 * destino no banco para que o cálculo de frete possa usá-lo.
 *
 * Devolve o resultado da consulta para a tela poder preencher rua e
 * bairro. Repare que rua e bairro são só conforto de preenchimento: eles
 * não entram em conta nenhuma. Cidade e UF, que entram, seguem por este
 * caminho de escrita e nunca pelo formulário.
 *
 * Se a gravação falhar, a consulta ainda é devolvida — a tela continua
 * útil, e quem recusa o pedido por destino não resolvido é o banco, no
 * momento da criação. Falhar aqui nunca vira preço errado.
 */
export async function resolveAndStorePostalCode(rawPostalCode: string): Promise<PostalCodeLookup> {
  const lookup = await lookupPostalCode(rawPostalCode);
  if (lookup.status !== "found") {
    return lookup;
  }

  try {
    const client = createShippingServiceClient();
    await client.rpc("shipping_postal_code_upsert", {
      p_postal_code: lookup.address.postalCode,
      p_city: lookup.address.city ?? "",
      p_state: lookup.address.state ?? "",
    });
  } catch {
    // Sem rethrow: um erro de gravação não pode derrubar o checkout. O
    // efeito prático é o destino continuar não resolvido, e o pedido de
    // entrega ser recusado com mensagem clara — nunca cobrado errado.
  }

  return lookup;
}
