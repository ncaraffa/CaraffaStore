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
