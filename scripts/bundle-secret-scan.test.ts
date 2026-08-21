import { describe, expect, it } from "vitest";
import { jwtRole, scanBundleForSecrets } from "./bundle-secret-scan";

/**
 * O scanner do release:check passou a distinguir a chave PÚBLICA do
 * Supabase de um segredo real. Um teste em cada direção, porque afrouxar
 * um gate de segurança sem prova é como não ter gate:
 *
 *   - a anon key precisa passar (senão o gate vive vermelho e a equipe
 *     aprende a ignorá-lo);
 *   - a service role key precisa reprovar (é o vazamento que importa).
 */

/** Monta um JWT de mentira com o papel pedido — só o payload interessa. */
function fakeJwt(role: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ iss: "supabase", role, iat: 1, exp: 2 })).toString("base64url");
  return `${header}.${payload}.c2lnbmF0dXJlLWZha2U`;
}

const ANON = fakeJwt("anon");
const SERVICE = fakeJwt("service_role");

describe("jwtRole", () => {
  it("lê o papel declarado no payload", () => {
    expect(jwtRole(ANON)).toBe("anon");
    expect(jwtRole(SERVICE)).toBe("service_role");
  });

  it("devolve null para o que não é um JWT legível", () => {
    expect(jwtRole("nem-de-longe-um-jwt")).toBeNull();
    expect(jwtRole("eyJhbGciOiJIUzI1NiJ9.%%%.zzz")).toBeNull();
  });
});

describe("scanBundleForSecrets", () => {
  it("aceita a anon key no bundle — ela é NEXT_PUBLIC_ por desenho", () => {
    const hits = scanBundleForSecrets(
      [{ path: "chunk.js", content: `var e={NEXT_PUBLIC_SUPABASE_ANON_KEY:"${ANON}"}` }],
      [],
    );
    expect(hits).toEqual([]);
  });

  it("REPROVA a service role key, mesmo sem ela estar no ambiente", () => {
    const hits = scanBundleForSecrets([{ path: "chunk.js", content: `const k="${SERVICE}"` }], []);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toContain("role=service_role");
  });

  it("reprova um JWT de papel desconhecido em vez de deixar passar", () => {
    const hits = scanBundleForSecrets([{ path: "chunk.js", content: fakeJwt("postgres") }], []);
    expect(hits[0]).toContain("role=postgres");
  });

  it("reprova o VALOR de um segredo de servidor, mesmo sem formato de JWT", () => {
    const secret = "chave-aes-256-em-base64-bem-comprida";
    const hits = scanBundleForSecrets(
      [{ path: "chunk.js", content: `const k="${secret}"` }],
      [{ name: "PAYMENT_ENCRYPTION_KEY", value: secret }],
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]).toContain("valor de PAYMENT_ENCRYPTION_KEY");
  });

  it("o NOME de uma variável de servidor não é segredo e não reprova sozinho", () => {
    // lib/supabase/env.ts declara esse nome num schema Zod que é
    // bundlado. Era exatamente esse falso positivo que mantinha o gate
    // vermelho em todo build local.
    const hits = scanBundleForSecrets(
      [{ path: "chunk.js", content: 'z.object({SUPABASE_SERVICE_ROLE_KEY:z.string().min(1)})' }],
      [{ name: "SUPABASE_SERVICE_ROLE_KEY", value: "valor-real-que-nao-esta-no-bundle" }],
    );
    expect(hits).toEqual([]);
  });

  it("continua reprovando chave privada e credencial de gateway", () => {
    expect(
      scanBundleForSecrets([{ path: "a.js", content: "-----BEGIN RSA PRIVATE KEY-----" }], []),
    ).toHaveLength(1);
    expect(scanBundleForSecrets([{ path: "b.js", content: "sk_live_abc123XYZ" }], [])).toHaveLength(1);
  });

  it("não duplica o mesmo achado quando ele aparece várias vezes", () => {
    const hits = scanBundleForSecrets(
      [{ path: "chunk.js", content: `${SERVICE} ... ${SERVICE}` }],
      [],
    );
    expect(hits).toHaveLength(1);
  });
});
