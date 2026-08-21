import { describe, expect, it, vi } from "vitest";
import { lookupPostalCode, parseViaCepPayload } from "./postal-code-lookup";

/**
 * O que importa aqui é o requisito da tarefa: o checkout NUNCA pode
 * ficar inutilizável porque o serviço de CEP caiu. Toda falha possível —
 * 5xx, timeout, JSON quebrado, CEP inexistente, resposta sem cidade —
 * tem que virar um estado que a tela sabe tratar, nunca uma exceção.
 */

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe("parseViaCepPayload", () => {
  it("traduz uma resposta completa", () => {
    const result = parseViaCepPayload(
      { cep: "79002-000", logradouro: "Rua 14 de Julho", bairro: "Centro", localidade: "Campo Grande", uf: "MS" },
      "79002000",
    );
    expect(result).toEqual({
      status: "found",
      address: {
        postalCode: "79002000",
        street: "Rua 14 de Julho",
        neighborhood: "Centro",
        city: "Campo Grande",
        state: "MS",
      },
    });
  });

  it("aceita o marcador de erro do ViaCEP nas duas formas (string e booleano)", () => {
    expect(parseViaCepPayload({ erro: "true" }, "99999999").status).toBe("not_found");
    expect(parseViaCepPayload({ erro: true }, "99999999").status).toBe("not_found");
  });

  it("CEP sem cidade/UF é inútil para frete e cai no preenchimento manual", () => {
    expect(parseViaCepPayload({ cep: "79002-000", logradouro: "Rua X" }, "79002000").status).toBe("not_found");
    expect(parseViaCepPayload({ localidade: "Campo Grande" }, "79002000").status).toBe("not_found");
  });

  it("CEP de logradouro único (sem rua/bairro) ainda serve — cidade e UF bastam para a faixa", () => {
    const result = parseViaCepPayload({ cep: "79330-000", localidade: "Corumbá", uf: "ms" }, "79330000");
    expect(result.status).toBe("found");
    if (result.status !== "found") return;
    expect(result.address.street).toBeNull();
    expect(result.address.neighborhood).toBeNull();
    expect(result.address.state).toBe("MS");
  });

  it("resposta que não é objeto vira indisponível, não exceção", () => {
    expect(parseViaCepPayload(null, "79002000").status).toBe("unavailable");
    expect(parseViaCepPayload("<html>502</html>", "79002000").status).toBe("unavailable");
  });
});

describe("lookupPostalCode", () => {
  it("nem consulta a rede com CEP incompleto", async () => {
    const fetchMock = vi.fn();
    expect((await lookupPostalCode("793", fetchMock as unknown as typeof fetch)).status).toBe("invalid");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("consulta com o CEP normalizado, aceitando o que a pessoa digitou com máscara", async () => {
    const seen: string[] = [];
    const fetchMock = vi.fn(async (url: string) => {
      seen.push(url);
      return jsonResponse({ cep: "79330-000", localidade: "Corumbá", uf: "MS" });
    });
    const result = await lookupPostalCode("79330-000", fetchMock as unknown as typeof fetch);
    expect(result.status).toBe("found");
    expect(seen[0]).toContain("/79330000/json/");
  });

  it("serviço fora do ar (5xx) vira 'unavailable' — o checkout segue à mão", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}, 503));
    expect((await lookupPostalCode("79330000", fetchMock as unknown as typeof fetch)).status).toBe("unavailable");
  });

  it("400 do provedor é CEP mal formado, não queda de serviço", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}, 400));
    expect((await lookupPostalCode("79330000", fetchMock as unknown as typeof fetch)).status).toBe("invalid");
  });

  it("timeout / erro de rede nunca propaga exceção para a tela", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("The operation was aborted due to timeout");
    });
    expect((await lookupPostalCode("79330000", fetchMock as unknown as typeof fetch)).status).toBe("unavailable");
  });

  it("JSON quebrado também vira 'unavailable'", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected token");
      },
    }) as unknown as Response);
    expect((await lookupPostalCode("79330000", fetchMock as unknown as typeof fetch)).status).toBe("unavailable");
  });
});
