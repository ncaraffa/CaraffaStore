import { createCipheriv } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptWithKey, encryptWithKey, getEncryptionKeyFromEnv } from "./crypto-core";

const KEY_A = Buffer.alloc(32, 7);
const KEY_B = Buffer.alloc(32, 9);

describe("lib/payments/crypto-core", () => {
  it("criptografa e descriptografa corretamente (round-trip)", () => {
    const plaintext = "APP_USR-1234567890123456-000000-abcdef0123456789abcdef0123456789-987654321";
    const encrypted = encryptWithKey(plaintext, KEY_A);
    expect(decryptWithKey(encrypted, KEY_A)).toBe(plaintext);
  });

  it("gera ciphertext diferente para o mesmo valor por IV aleatório", () => {
    const plaintext = "same-secret-value";
    const a = encryptWithKey(plaintext, KEY_A);
    const b = encryptWithKey(plaintext, KEY_A);
    expect(a).not.toBe(b);
    expect(a.split(":")[0]).not.toBe(b.split(":")[0]);
  });

  it("falha ao descriptografar com a chave errada", () => {
    const encrypted = encryptWithKey("secret-value", KEY_A);
    expect(() => decryptWithKey(encrypted, KEY_B)).toThrow();
  });

  it("falha ao descriptografar um ciphertext adulterado (autenticação)", () => {
    const encrypted = encryptWithKey("secret-value", KEY_A);
    const [iv, tag] = encrypted.split(":");
    const tampered = [iv, tag, Buffer.from("valor-adulterado!!").toString("base64")].join(":");
    expect(() => decryptWithKey(tampered, KEY_A)).toThrow();
  });

  it("falha ao descriptografar com a authTag adulterada", () => {
    const encrypted = encryptWithKey("secret-value", KEY_A);
    const [iv, , ciphertext] = encrypted.split(":");
    const tampered = [iv, Buffer.alloc(16, 1).toString("base64"), ciphertext].join(":");
    expect(() => decryptWithKey(tampered, KEY_A)).toThrow();
  });

  it("falha ao descriptografar um valor malformado (sem 3 partes)", () => {
    expect(() => decryptWithKey("not-a-valid-encoded-value", KEY_A)).toThrow();
  });

  /* ---------------------------------------------------------------
     Tamanho da authentication tag (gcm-no-tag-length)

     Sem `authTagLength` fixado, o GCM do Node aceita tags de 4 a 16
     bytes. Uma tag truncada reduz a verificação de 2^128 para 2^32 e
     abre espaço para forjar ciphertext, então truncar tem que ser
     recusado — não apenas "falhar por acaso" na comparação.
     --------------------------------------------------------------- */

  it("a tag gerada tem exatamente 16 bytes", () => {
    const [, tagB64] = encryptWithKey("secret-value", KEY_A).split(":") as [string, string, string];
    expect(Buffer.from(tagB64, "base64").length).toBe(16);
  });

  it.each([4, 8, 12, 15])(
    "recusa uma authentication tag truncada para %i bytes",
    (bytes) => {
      const encrypted = encryptWithKey("secret-value", KEY_A);
      const [iv, tag, ciphertext] = encrypted.split(":") as [string, string, string];
      const truncated = Buffer.from(tag, "base64").subarray(0, bytes).toString("base64");
      expect(() => decryptWithKey([iv, truncated, ciphertext].join(":"), KEY_A)).toThrow(
        /authentication tag/i,
      );
    },
  );

  it("recusa um IV de tamanho diferente de 12 bytes", () => {
    const [, tag, ciphertext] = encryptWithKey("secret-value", KEY_A).split(":") as [
      string,
      string,
      string,
    ];
    for (const bytes of [8, 16]) {
      const iv = Buffer.alloc(bytes, 2).toString("base64");
      expect(() => decryptWithKey([iv, tag, ciphertext].join(":"), KEY_A)).toThrow(/IV/i);
    }
  });

  /**
   * Compatibilidade com o que já está gravado em produção: reproduz o
   * caminho ANTERIOR à correção (sem a opção `authTagLength`, usando o
   * padrão do Node) e prova que esse valor continua sendo lido. É o teste
   * que garante que fixar o tamanho da tag não invalidou nenhuma
   * credencial de loja já criptografada no banco.
   */
  it("continua lendo valores gerados antes de fixar authTagLength", () => {
    const plaintext = "APP_USR-credencial-gravada-antes-da-correcao";
    const iv = Buffer.alloc(12, 5);
    const cipher = createCipheriv("aes-256-gcm", KEY_A, iv); // sem authTagLength, como antes
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const legacy = [
      iv.toString("base64"),
      cipher.getAuthTag().toString("base64"),
      ciphertext.toString("base64"),
    ].join(":");

    expect(decryptWithKey(legacy, KEY_A)).toBe(plaintext);
  });

  it("getEncryptionKeyFromEnv falha quando a variável está ausente", () => {
    expect(() => getEncryptionKeyFromEnv(undefined)).toThrow(/PAYMENT_ENCRYPTION_KEY/);
    expect(() => getEncryptionKeyFromEnv("")).toThrow(/PAYMENT_ENCRYPTION_KEY/);
  });

  it("getEncryptionKeyFromEnv falha quando a chave não tem 32 bytes", () => {
    expect(() => getEncryptionKeyFromEnv(Buffer.alloc(16, 1).toString("base64"))).toThrow(/32 bytes/);
  });

  it("getEncryptionKeyFromEnv aceita uma chave válida de 32 bytes em base64", () => {
    const key = getEncryptionKeyFromEnv(Buffer.alloc(32, 3).toString("base64"));
    expect(key.length).toBe(32);
  });
});
