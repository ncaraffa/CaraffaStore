/**
 * Hook nativo do Next.js (`instrumentation.ts` na raiz, sem flag
 * experimental necessária a partir da versão usada neste projeto):
 * `register()` roda uma única vez, no boot do processo do servidor,
 * antes de qualquer requisição ser aceita. É o ponto certo para o
 * fail-fast de produção — se faltar/estiver inválida uma variável de
 * ambiente obrigatória, o processo derruba aqui, nunca no meio de uma
 * requisição de usuário.
 *
 * `NEXT_RUNTIME` distingue o runtime Node.js do Edge; a validação usa
 * `node:crypto`-adjacent APIs indiretamente (URL) mas é mantida restrita
 * ao runtime Node.js por clareza — é o único runtime usado pelas rotas
 * desta aplicação (ver next.config.ts / rotas de API).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { assertProductionEnv } = await import("./lib/env/production-env");
    assertProductionEnv();
  }
}
