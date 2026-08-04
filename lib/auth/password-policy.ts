import { createHash } from "node:crypto";

// T2-DEC-011: mínimo de 15 caracteres; aceita bem além de 64 (limite
// prático de 128 aqui, só para evitar entradas absurdamente longas).
// Sem exigência de composição (maiúscula/minúscula/número/símbolo) e sem
// troca periódica forçada — nenhuma das duas é verificada neste módulo.
export const MIN_PASSWORD_LENGTH = 15;
export const MAX_PASSWORD_LENGTH = 128;

export interface PasswordPolicyResult {
  valid: boolean;
  errors: string[];
}

/**
 * Valida só comprimento — nunca composição. Espaços (inclusive líderes/
 * finais) e frases-senha são aceitos como digitados; a senha nunca é
 * transformada (trim/normalize) antes de ser usada, para não alterar
 * silenciosamente o que o usuário definiu.
 */
export function validatePasswordPolicy(password: unknown): PasswordPolicyResult {
  const errors: string[] = [];

  if (typeof password !== "string") {
    return { valid: false, errors: ["Senha inválida."] };
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    errors.push(`A senha precisa ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`);
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    errors.push(`A senha pode ter no máximo ${MAX_PASSWORD_LENGTH} caracteres.`);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Verificação de senha vazada via k-anonimato (Have I Been Pwned, Pwned
 * Passwords API): só os 5 primeiros caracteres do hash SHA-1 da senha
 * saem da máquina; a senha completa nunca é enviada nem logada.
 *
 * Preparado/documentado conforme T2-DEC-011; o Supabase local
 * (self-hosted, supabase/config.toml) não expõe uma opção equivalente
 * para ativar isso na plataforma — esta é a camada de aplicação.
 * Desativado por padrão (HIBP_PASSWORD_CHECK_ENABLED=false) porque
 * depende de acesso à internet, indisponível em CI/ambientes isolados.
 * `fetchImpl` é injetável para testes sem rede real.
 */
export async function isPasswordLeaked(
  password: string,
  options: { fetchImpl?: typeof fetch; enabled?: boolean } = {},
): Promise<boolean> {
  const enabled = options.enabled ?? process.env.HIBP_PASSWORD_CHECK_ENABLED === "true";
  if (!enabled) return false;

  const fetchImpl = options.fetchImpl ?? fetch;
  const sha1 = createHash("sha1").update(password, "utf8").digest("hex").toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);

  let response: Response;
  try {
    response = await fetchImpl(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { "Add-Padding": "true" },
    });
  } catch {
    // Falha aberta: indisponibilidade do serviço externo não pode
    // impedir cadastro/recuperação local.
    return false;
  }

  if (!response.ok) return false;

  const body = await response.text();
  return body.split("\n").some((line) => {
    const trimmed = line.trim();
    const [lineSuffix, countRaw] = trimmed.split(":");
    return lineSuffix?.toUpperCase() === suffix && Number(countRaw) > 0;
  });
}
