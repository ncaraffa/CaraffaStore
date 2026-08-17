import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    // O padrão de node_modules leva o prefixo recursivo: sem ele, só a
    // pasta da raiz era excluída e qualquer node_modules aninhada entrava
    // na varredura. Vários pacotes publicam os próprios testes junto do
    // código-fonte, e o vitest passava a executá-los — testes de
    // terceiros, com dependências que não instalamos, falhando por motivo
    // nenhum ligado a esta aplicação.
    //
    // A pasta video/ sai por ser um projeto isolado, com package.json e
    // dependências próprias (o filme de produto em Remotion). Não faz
    // parte da suíte da aplicação, no mesmo espírito do "video" excluído
    // em tsconfig.json.
    exclude: ["**/node_modules/**", ".next/**", "video/**"],
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "."),
    },
  },
});
