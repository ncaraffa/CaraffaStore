/**
 * Scan de segredos no bundle de produção (.next/static), extraído de
 * scripts/release-check.ts para poder ser testado nos DOIS sentidos:
 * que a chave pública passa e que um vazamento real reprova.
 *
 * Sem isso, a única forma de exercitar o scanner era rodar o
 * release:check inteiro — que refaz o build e apaga qualquer arquivo de
 * teste plantado em .next/static antes de chegar ao scan.
 *
 * O CRITÉRIO
 *
 * Uma chave JWT no bundle é ESPERADA: a anon key do Supabase é marcada
 * `NEXT_PUBLIC_` justamente para ir ao navegador — é ela que o cliente
 * usa para falar com o PostgREST, e quem protege os dados é a RLS, não o
 * sigilo da chave. Reprovar isso treinava a equipe a conviver com um
 * gate vermelho, que é o pior resultado possível para um scanner.
 *
 * Então não se aceita "qualquer JWT": decodifica-se o payload e olha-se
 * o papel declarado. `anon` passa; `service_role` e qualquer outro
 * reprovam, agora dizendo QUAL papel vazou.
 */

export interface BundleFile {
  /** Caminho relativo à raiz, só para a mensagem de erro. */
  path: string;
  content: string;
}

export interface ServerSecret {
  name: string;
  value: string;
}

/** Papel declarado por um JWT, ou null se não for um JWT legível. */
export function jwtRole(token: string): string | null {
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const decoded: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof decoded === "object" && decoded !== null && "role" in decoded) {
      const role = (decoded as { role: unknown }).role;
      return typeof role === "string" ? role : null;
    }
    return null;
  } catch {
    return null;
  }
}

const JWT_IN_BUNDLE = /eyJhbGci[A-Za-z0-9_-]{20,}(?:\.[A-Za-z0-9_-]+){0,2}/g;

/**
 * Padrões que continuam sendo reprovação imediata, independentemente de
 * qualquer decodificação.
 */
export const HARD_SECRET_PATTERNS = [/sk_live_[A-Za-z0-9]+/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/];

/**
 * `serverSecrets` são os VALORES das variáveis de servidor presentes no
 * ambiente. Comparar por valor é mais forte do que procurar pelo NOME da
 * variável: nome não é segredo (e aparecia legitimamente no schema Zod
 * de lib/supabase/env.ts, que é bundlado), enquanto o valor inline é
 * exatamente o vazamento que interessa.
 */
export function scanBundleForSecrets(files: BundleFile[], serverSecrets: ServerSecret[]): string[] {
  const hits: string[] = [];

  for (const file of files) {
    for (const secret of serverSecrets) {
      if (secret.value.length >= 16 && file.content.includes(secret.value)) {
        hits.push(`${file.path} (valor de ${secret.name})`);
      }
    }

    for (const token of file.content.match(JWT_IN_BUNDLE) ?? []) {
      const role = jwtRole(token);
      if (role === "anon") continue; // chave pública do Supabase, por desenho
      hits.push(`${file.path} (JWT com role=${role ?? "desconhecido"})`);
    }

    for (const pattern of HARD_SECRET_PATTERNS) {
      if (pattern.test(file.content)) {
        hits.push(`${file.path} (${pattern.source})`);
      }
    }
  }

  return [...new Set(hits)];
}
