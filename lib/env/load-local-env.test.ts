import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { loadLocalEnv } from "./load-local-env";

/**
 * FINAL-BUG-001 (qa/reports/TASK-001-RETEST-2.md): `npm run seed:local`
 * não carregava `.env.local` automaticamente porque `tsx` (diferente do
 * runtime do Next.js) não faz isso sozinho. Estes testes cobrem o
 * carregador (lib/env/load-local-env.ts) isoladamente, sem depender de
 * Docker/Supabase nem do computador atual — usam diretórios temporários
 * descartáveis.
 *
 * Duas particularidades reais de `@next/env` (a mesma lib usada por
 * `next dev`/`next build`) moldam este arquivo de teste:
 *
 * 1. `loadEnvConfig` EXCLUI `.env.local` de propósito quando
 *    `NODE_ENV=test` (evita vazar segredos locais em CI — comportamento
 *    documentado do Next.js). O Vitest define `NODE_ENV=test` por
 *    padrão, então trocamos para "development" ao redor de cada chamada,
 *    simulando o uso real (`npm run seed:local` rodado por uma pessoa).
 * 2. `loadEnvConfig` guarda, na primeira vez que é chamada em um
 *    processo, um snapshot de `process.env` como "baseline" e o
 *    restaura antes de aplicar qualquer arquivo — é assim que uma
 *    variável já exportada nunca é sobrescrita por um `.env.local`. Por
 *    isso o teste de precedência (nº 3) define sua variável num
 *    `beforeAll`, garantindo que ela já exista da primeira vez que
 *    `loadLocalEnv` é chamado neste arquivo — exatamente como aconteceria
 *    numa pessoa exportando a variável antes de rodar o comando.
 */

const PRECEDENCE_VAR = "LOAD_LOCAL_ENV_PRECEDENCE_VAR";
const PRECEDENCE_VALUE = "valor-ja-existente-no-processo";

const TRACKED_TEST_KEYS = [
  "LOAD_LOCAL_ENV_TEST_VAR",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
];

const tempDirs: string[] = [];
const originalNodeEnv = process.env.NODE_ENV;

// `next/types` declara `NODE_ENV` como readonly para impedir mutação
// acidental em código de aplicação — mas o teste precisa simular
// explicitamente o `NODE_ENV` de uso real (ver nota 1 do comentário
// acima), daí o cast pontual.
function setNodeEnv(value: string): void {
  (process.env as { NODE_ENV: string }).NODE_ENV = value;
}

function makeTempProjectDir(envLocalContents: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "load-local-env-test-"));
  writeFileSync(path.join(dir, ".env.local"), envLocalContents, "utf8");
  tempDirs.push(dir);
  return dir;
}

describe("lib/env/load-local-env — carregamento de .env.local", () => {
  beforeAll(() => {
    // Precisa existir ANTES da primeira chamada a loadLocalEnv deste
    // arquivo — ver nota 2 do comentário acima.
    process.env[PRECEDENCE_VAR] = PRECEDENCE_VALUE;
  });

  afterAll(() => {
    delete process.env[PRECEDENCE_VAR];
  });

  beforeEach(() => {
    for (const key of TRACKED_TEST_KEYS) delete process.env[key];
    setNodeEnv("development");
  });

  afterEach(() => {
    for (const key of TRACKED_TEST_KEYS) delete process.env[key];
    setNodeEnv(originalNodeEnv ?? "test");
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("1. encontra e carrega .env.local a partir de um diretório temporário", () => {
    const dir = makeTempProjectDir("LOAD_LOCAL_ENV_TEST_VAR=valor-do-arquivo\n");

    const result = loadLocalEnv(dir);

    expect(result.loadedEnvFiles).toContain(".env.local");
    expect(process.env.LOAD_LOCAL_ENV_TEST_VAR).toBe("valor-do-arquivo");
  });

  it("2. as três variáveis obrigatórias do Supabase ficam disponíveis em process.env após o carregamento", () => {
    const dir = makeTempProjectDir(
      [
        "NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321",
        "NEXT_PUBLIC_SUPABASE_ANON_KEY=anon-key-de-teste",
        "SUPABASE_SERVICE_ROLE_KEY=service-role-key-de-teste",
      ].join("\n") + "\n",
    );

    loadLocalEnv(dir);

    expect(process.env.NEXT_PUBLIC_SUPABASE_URL).toBe("http://127.0.0.1:54321");
    expect(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY).toBe("anon-key-de-teste");
    expect(process.env.SUPABASE_SERVICE_ROLE_KEY).toBe("service-role-key-de-teste");
  });

  it("3. uma variável já presente em process.env nunca é sobrescrita pelo .env.local (precedência do Next.js)", () => {
    const dir = makeTempProjectDir(`${PRECEDENCE_VAR}=valor-diferente-do-arquivo\n`);

    loadLocalEnv(dir);

    expect(process.env[PRECEDENCE_VAR]).toBe(PRECEDENCE_VALUE);
  });

  it("6. .env.local está listado no .gitignore do projeto (nunca deve ser versionado)", () => {
    const gitignorePath = path.resolve(import.meta.dirname, "../../.gitignore");
    const gitignore = readFileSync(gitignorePath, "utf8");
    const lines = gitignore.split("\n").map((line) => line.trim());

    expect(lines).toContain(".env.local");
  });
});
