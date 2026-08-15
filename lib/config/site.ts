/**
 * Identidade pública da CaraffaStore — domínio, host exibido e e-mail de
 * contato. Existe para que a migração de `*.vercel.app` para um domínio
 * próprio (e de um e-mail pessoal para `contato@dominio`) seja uma troca
 * de variável de ambiente, nunca uma caçada por string espalhada pelo
 * código.
 *
 * Nada aqui altera comportamento: são só os valores que a interface
 * exibe. Todas as variáveis são OPCIONAIS e caem no valor atualmente em
 * uso — nenhum ambiente existente quebra por não as ter definido, e
 * `lib/env/production-env.ts` continua exigindo exatamente as mesmas
 * variáveis de antes.
 *
 * O prefixo NEXT_PUBLIC_ é deliberado: estes valores são públicos por
 * natureza (aparecem na página) e precisam existir também em Client
 * Components. Nunca coloque segredo aqui.
 */
import { getSiteUrl as resolveSiteUrl } from "@/lib/auth/site-url";

/** E-mail de contato hoje confirmado no projeto. Não invente outro. */
const DEFAULT_CONTACT_EMAIL = "caraffastore@gmail.com";

/**
 * E-mail exibido em Termos, Privacidade e suporte. Trocar para
 * `contato@seudominio.com.br` é definir NEXT_PUBLIC_CONTACT_EMAIL — o
 * texto das páginas legais acompanha sozinho.
 */
export function getContactEmail(): string {
  const configured = process.env.NEXT_PUBLIC_CONTACT_EMAIL?.trim();
  return configured && configured.length > 0 ? configured : DEFAULT_CONTACT_EMAIL;
}

/**
 * URL absoluta do site, para metadata/OpenGraph/canonical.
 *
 * Reexporta `lib/auth/site-url.ts` de propósito, em vez de repetir a
 * leitura da variável e o fallback de dev: aquele módulo é a fonte dos
 * redirects do Supabase Auth, e duas implementações do mesmo endereço
 * são exatamente o tipo de coisa que diverge silenciosamente. Também é o
 * que mantém o literal de host local em UM arquivo só — o que
 * `scripts/release-check.ts` verifica.
 *
 * Função explícita em vez de `export { getSiteUrl } from ...`: o
 * re-export não traz o nome para o escopo do módulo, e `getSiteHost()`
 * logo abaixo precisa chamá-lo.
 */
export function getSiteUrl(): string {
  return resolveSiteUrl();
}

/**
 * Host sem protocolo, do jeito que um lojista leria, usado nos exemplos
 * de endereço de loja. Deriva do site URL em vez de repetir o domínio
 * como literal em cada tela.
 *
 * Se o valor configurado não for uma URL válida, o fallback só remove o
 * esquema do que veio — nunca inventa um domínio que não existe.
 */
export function getSiteHost(): string {
  const raw = getSiteUrl();
  try {
    return new URL(raw).host;
  } catch {
    return raw.replace(/^[a-z]+:\/\//i, "").replace(/\/.*$/, "");
  }
}

/**
 * Exemplo de endereço público de loja — o que o lojista vai mandar no
 * WhatsApp. `slug` fica configurável só para não repetir a loja de
 * exemplo em cada chamada.
 */
export function getStoreUrlExample(slug = "casa-do-cafe"): string {
  return `${getSiteHost()}/loja/${slug}`;
}
