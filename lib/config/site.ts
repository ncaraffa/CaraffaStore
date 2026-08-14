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

/** E-mail de contato hoje confirmado no projeto. Não invente outro. */
const DEFAULT_CONTACT_EMAIL = "caraffastore@gmail.com";

/** Mesmo default de lib/auth/site-url.ts, para dev local sem env. */
const DEFAULT_SITE_URL = "http://127.0.0.1:3000";

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
 * URL absoluta do site, para metadata/OpenGraph/canonical. Espelha
 * `lib/auth/site-url.ts` (que é a fonte para redirects do Supabase Auth)
 * — as duas leem a MESMA variável, então nunca divergem.
 */
export function getSiteUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  return configured && configured.length > 0 ? configured : DEFAULT_SITE_URL;
}

/**
 * Host sem protocolo, do jeito que um lojista leria ("caraffastore.com.br"),
 * usado nos exemplos de endereço de loja. Deriva do site URL em vez de
 * repetir o domínio como literal em cada tela.
 */
export function getSiteHost(): string {
  try {
    return new URL(getSiteUrl()).host;
  } catch {
    return "caraffastore.com.br";
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
