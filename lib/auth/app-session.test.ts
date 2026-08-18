import { describe, expect, it } from "vitest";
import { browserLabel, HEARTBEAT_INTERVAL_MS, STALE_WINDOW_MINUTES } from "./app-session";

describe("browserLabel", () => {
  it("reconhece os navegadores comuns com a plataforma", () => {
    expect(browserLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36")).toBe(
      "Chrome (Windows)",
    );
    expect(browserLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Version/17.0 Safari/605.1")).toBe(
      "Safari (iPhone/iPad)",
    );
    expect(browserLabel("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Firefox/121.0")).toBe("Firefox (Mac)");
  });

  /**
   * Edge e Opera anunciam "Chrome" no próprio UA. Se a ordem dos testes
   * estiver errada, um usuário de Edge vê "Chrome" e não reconhece a
   * própria sessão na hora de decidir o takeover.
   */
  it("distingue Edge e Opera de Chrome apesar de ambos citarem Chrome no UA", () => {
    expect(browserLabel("Mozilla/5.0 (Windows NT 10.0) Chrome/120.0.0.0 Safari/537.36 Edg/120.0")).toBe(
      "Edge (Windows)",
    );
    expect(browserLabel("Mozilla/5.0 (Windows NT 10.0) Chrome/120.0.0.0 Safari/537.36 OPR/106.0")).toBe(
      "Opera (Windows)",
    );
  });

  it("degrada com elegância quando não há User-Agent", () => {
    expect(browserLabel(null)).toBe("Dispositivo desconhecido");
    expect(browserLabel(undefined)).toBe("Dispositivo desconhecido");
    expect(browserLabel("algo-totalmente-desconhecido")).toBe("Navegador");
  });

  /**
   * O rótulo é só para a pessoa se reconhecer. Não pode virar
   * identificador: dois aparelhos iguais têm que produzir o MESMO texto,
   * e nada de versão/build vaza para ele.
   */
  it("não carrega versão nem qualquer coisa que sirva de fingerprint", () => {
    const a = browserLabel("Mozilla/5.0 (Windows NT 10.0) Chrome/120.0.6099.109 Safari/537.36");
    const b = browserLabel("Mozilla/5.0 (Windows NT 10.0) Chrome/121.0.6167.85 Safari/537.36");
    expect(a).toBe(b);
    expect(a).not.toMatch(/\d/);
  });
});

describe("janelas de heartbeat e stale", () => {
  /**
   * A batida precisa caber várias vezes dentro da janela de stale do
   * banco (app_session_stale_window() = 30 min). Se alguém encurtar a
   * janela ou alongar o intervalo sem pensar, o cliente legítimo passa a
   * ser desconectado sozinho quando a aba fica em segundo plano.
   */
  it("tolera pelo menos 5 batidas perdidas antes de a sessão virar stale", () => {
    const staleMs = STALE_WINDOW_MINUTES * 60 * 1000;
    expect(staleMs / HEARTBEAT_INTERVAL_MS).toBeGreaterThanOrEqual(5);
  });

  it("não faz polling agressivo", () => {
    expect(HEARTBEAT_INTERVAL_MS).toBeGreaterThanOrEqual(60 * 1000);
  });
});
