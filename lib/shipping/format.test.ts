import { describe, expect, it } from "vitest";
import {
  centsToCurrencyInput,
  currencyToCents,
  formatCityState,
  formatPostalCode,
  isBrazilianState,
  isCompletePostalCode,
  normalizeCity,
  normalizePostalCode,
  normalizeState,
  SHIPPING_RULE_LABEL,
} from "./format";

describe("normalizePostalCode", () => {
  it("guarda só os dígitos — a máscara é coisa da tela, não do dado", () => {
    expect(normalizePostalCode("79330-000")).toBe("79330000");
    expect(normalizePostalCode("79330 000")).toBe("79330000");
    expect(normalizePostalCode(" 79.330-000 ")).toBe("79330000");
  });

  it("corta em 8 dígitos: colar um telefone no campo de CEP não vira um CEP longo", () => {
    expect(normalizePostalCode("7933000012345")).toBe("79330000");
  });

  it("aceita CEP incompleto sem inventar dígito", () => {
    expect(normalizePostalCode("793")).toBe("793");
    expect(isCompletePostalCode("793")).toBe(false);
    expect(isCompletePostalCode("79330-000")).toBe(true);
  });
});

describe("formatPostalCode", () => {
  it("põe o hífen só depois do quinto dígito", () => {
    expect(formatPostalCode("79330000")).toBe("79330-000");
    expect(formatPostalCode("79330")).toBe("79330");
    expect(formatPostalCode("793")).toBe("793");
  });

  it("não atrapalha quem ainda está digitando (nunca completa nem trava)", () => {
    expect(formatPostalCode("793300")).toBe("79330-0");
  });
});

describe("normalizeCity / normalizeState", () => {
  /**
   * Estes casos são o espelho em TypeScript de
   * public.shipping_normalize_city. A comparação que decide dinheiro
   * acontece no banco; aqui só garantimos que a tela não descreve uma
   * faixa diferente da que será cobrada.
   */
  it("acento e caixa não podem separar a mesma cidade", () => {
    expect(normalizeCity("Corumbá")).toBe(normalizeCity("CORUMBA"));
    expect(normalizeCity("São Paulo")).toBe(normalizeCity("sao paulo"));
    expect(normalizeCity("Cuiabá")).toBe("CUIABA");
  });

  it("colapsa espaços repetidos e apara as pontas", () => {
    expect(normalizeCity("  sao   paulo  ")).toBe("SAO PAULO");
  });

  it("cidades diferentes continuam diferentes", () => {
    expect(normalizeCity("Corumbá")).not.toBe(normalizeCity("Campo Grande"));
  });

  it("UF vira maiúscula sem espaço", () => {
    expect(normalizeState(" ms ")).toBe("MS");
    expect(normalizeState("sp")).toBe("SP");
  });

  it("reconhece as 27 UFs e recusa o que não é UF", () => {
    expect(isBrazilianState("ms")).toBe(true);
    expect(isBrazilianState("SP")).toBe(true);
    expect(isBrazilianState("XX")).toBe(false);
    expect(isBrazilianState("")).toBe(false);
  });
});

describe("dinheiro", () => {
  it("aceita as formas que um lojista brasileiro digita de verdade", () => {
    expect(currencyToCents("10")).toBe(1000);
    expect(currencyToCents("10,00")).toBe(1000);
    expect(currencyToCents("R$ 35,00")).toBe(3500);
    expect(currencyToCents("1.250,50")).toBe(125050);
  });

  it("recusa o que não é valor em vez de virar zero em silêncio", () => {
    expect(currencyToCents("abc")).toBeNull();
    expect(currencyToCents("-5")).toBeNull();
    expect(currencyToCents("10,000")).toBeNull();
  });

  it("volta para o campo na forma que o lojista reconhece", () => {
    expect(centsToCurrencyInput(1500)).toBe("15,00");
    expect(centsToCurrencyInput(0)).toBe("0,00");
  });
});

describe("apresentação", () => {
  it("monta 'Cidade - UF' só quando tem as duas partes", () => {
    expect(formatCityState("Corumbá", "MS")).toBe("Corumbá - MS");
    expect(formatCityState("Corumbá", null)).toBeNull();
    expect(formatCityState(null, "MS")).toBeNull();
  });

  it("tem rótulo para todas as faixas que o banco pode gravar", () => {
    expect(Object.keys(SHIPPING_RULE_LABEL).sort()).toEqual(["free", "other_state", "same_city", "same_state"]);
  });
});
