import { z } from "zod";

const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
});

const serviceRoleEnvSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
});

/**
 * Extrai apenas os NOMES das variáveis que falharam na validação — nunca
 * o valor recebido. `issue.path` para um schema plano é sempre
 * `[nomeDaVariavel]`; nunca interpolar `issue.input`/`issue.message` do
 * zod aqui, pois podem ecoar o valor inválido.
 */
function missingVarNames(issues: { path: PropertyKey[] }[]): string {
  const names = issues
    .map((issue) => String(issue.path[0]))
    .filter((name, index, all) => name.length > 0 && all.indexOf(name) === index);
  return names.join(", ");
}

export function getPublicSupabaseEnv() {
  const parsed = publicEnvSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });

  if (!parsed.success) {
    throw new Error(
      `Variável(is) de ambiente ausente(s) ou inválida(s): ${missingVarNames(parsed.error.issues)}. ` +
        "Copie .env.example para .env.local e preencha com valores do seu " +
        "Supabase local (nunca de produção).",
    );
  }

  return parsed.data;
}

/**
 * Only for trusted server-side/dev scripts (e.g. scripts/seed-local.ts).
 * Never import this from code that handles a user request.
 */
export function getServiceRoleEnv() {
  if (typeof window !== "undefined") {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY nunca deve ser acessada no navegador.",
    );
  }

  const parsed = serviceRoleEnvSchema.safeParse({
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  });

  if (!parsed.success) {
    throw new Error(
      `Variável(is) de ambiente ausente(s) ou inválida(s): ${missingVarNames(parsed.error.issues)}. ` +
        "Preencha .env.local com a chave do seu Supabase local (nunca de " +
        "produção) antes de rodar scripts de seed.",
    );
  }

  return parsed.data;
}
