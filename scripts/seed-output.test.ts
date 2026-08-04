import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logSeedFailure, logSeedSummary } from "./seed-output";

/**
 * FINAL-BUG-002 (qa/reports/TASK-001-RETEST-3.md): o seed imprimia a
 * senha de desenvolvimento no stdout. Estes testes capturam a saída real
 * produzida por scripts/seed-output.ts (as únicas funções que imprimem
 * algo no fluxo de sucesso/erro do seed) e provam que nenhum segredo
 * aparece nela — não apenas que a documentação evita certas palavras.
 */

const KNOWN_DEV_PASSWORD = "dev-local-only-not-a-real-secret-123!";
const FAKE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.fake-anon-key-for-test";
const FAKE_SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.fake-service-role-key-for-test";

const FORBIDDEN_PATTERNS = [
  /password/i,
  /secret/i,
  /service_role/i,
  /bearer/i,
  /authorization/i,
];

const SAMPLE_IDS = {
  adminAId: "11111111-1111-4111-8111-111111111111",
  adminBId: "22222222-2222-4222-8222-222222222222",
  clienteAId: "33333333-3333-4333-8333-333333333333",
  clienteBId: "44444444-4444-4444-8444-444444444444",
  storeAId: "55555555-5555-4555-8555-555555555555",
  storeBId: "66666666-6666-4666-8666-666666666666",
  merchantOnboardingId: "77777777-7777-4777-8777-777777777777",
  merchantPendingId: "88888888-8888-4888-8888-888888888888",
  pendingStoreId: "99999999-9999-4999-8999-999999999999",
  merchantSuspendedId: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
  suspendedStoreId: "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb",
  merchantMultiId: "cccccccc-3333-4333-8333-cccccccccccc",
  multiStoreId: "dddddddd-4444-4444-8444-dddddddddddd",
};

function captureConsole() {
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  return {
    output(): string {
      return [...logSpy.mock.calls, ...errorSpy.mock.calls]
        .map((call) => call.join(" "))
        .join("\n");
    },
  };
}

describe("scripts/seed-output — nunca vaza credenciais (FINAL-BUG-002)", () => {
  let capture: ReturnType<typeof captureConsole>;

  beforeEach(() => {
    capture = captureConsole();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("1/3/4. a senha de dev, a anon key e a service role key conhecidas nunca aparecem na saída de sucesso", () => {
    logSeedSummary(SAMPLE_IDS);
    const output = capture.output();

    expect(output).not.toContain(KNOWN_DEV_PASSWORD);
    expect(output).not.toContain(FAKE_ANON_KEY);
    expect(output).not.toContain(FAKE_SERVICE_ROLE_KEY);
  });

  it("2. nenhum padrão associado a segredo aparece na saída de sucesso", () => {
    logSeedSummary(SAMPLE_IDS);
    const output = capture.output();

    for (const pattern of FORBIDDEN_PATTERNS) {
      expect(output).not.toMatch(pattern);
    }
  });

  it("5. mensagem de erro mostra só o texto da falha, mesmo se o Error carregar segredos em propriedades extras", () => {
    // Simula um erro real de biblioteca HTTP que embute detalhes da
    // requisição (headers, incluindo Authorization) numa propriedade
    // extra do objeto Error — logSeedFailure não deve nunca alcançar
    // essa propriedade, só `.message`.
    const leakedToken = "leaked-service-role-key-should-never-print";
    const error = new Error("Falha ao contatar o Supabase local") as Error & {
      config: unknown;
    };
    error.config = { headers: { Authorization: `Bearer ${leakedToken}` } };

    logSeedFailure(error);
    const output = capture.output();

    expect(output).toContain("Falha ao contatar o Supabase local");
    expect(output).not.toContain(leakedToken);
    expect(output).not.toMatch(/bearer/i);
    expect(output).not.toMatch(/authorization/i);
  });

  it("5. erros que não são instância de Error também não vazam propriedades extras", () => {
    const leakedToken = "another-leaked-secret-value";
    logSeedFailure({ message: "erro estranho", token: leakedToken });
    const output = capture.output();

    expect(output).not.toContain(leakedToken);
  });

  it("6/7. UUIDs e os nomes lógicos admin-a/admin-b/cliente-a continuam presentes e identificáveis", () => {
    logSeedSummary(SAMPLE_IDS);
    const output = capture.output();

    expect(output).toContain(SAMPLE_IDS.adminAId);
    expect(output).toContain(SAMPLE_IDS.adminBId);
    expect(output).toContain(SAMPLE_IDS.clienteAId);
    expect(output).toContain(SAMPLE_IDS.clienteBId);
    expect(output).toContain(SAMPLE_IDS.storeAId);
    expect(output).toContain(SAMPLE_IDS.storeBId);
    expect(output).toMatch(/admin-a/);
    expect(output).toMatch(/admin-b/);
    expect(output).toMatch(/cliente-a/);
  });

  it("8. a saída confirma sucesso sem imprimir nenhuma credencial conhecida", () => {
    logSeedSummary(SAMPLE_IDS);
    const output = capture.output();

    expect(output).toContain("Seed local concluído");
    expect(output).not.toContain(KNOWN_DEV_PASSWORD);
    expect(output).not.toContain(FAKE_ANON_KEY);
    expect(output).not.toContain(FAKE_SERVICE_ROLE_KEY);
  });

  it("guarda estática: scripts/seed-local.ts não tem nenhuma chamada console.* referenciando DEV_ONLY_PASSWORD", () => {
    const source = readFileSync(
      path.resolve(import.meta.dirname, "seed-local.ts"),
      "utf8",
    );
    const consoleCallsWithPassword = source
      .split("\n")
      .filter(
        (line) =>
          /console\.(log|error|warn|info)/.test(line) &&
          line.includes("DEV_ONLY_PASSWORD"),
      );

    expect(consoleCallsWithPassword).toEqual([]);
  });
});
