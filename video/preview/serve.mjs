import { createServer } from "node:http";
import { createReadStream, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Servidor estático mínimo só para conferir o filme antes de aprová-lo.
 *
 * Serve a página de `preview/` e os renders de `out/`. Não faz parte da
 * aplicação, não vai para produção e não tem dependência nenhuma — é
 * Node puro, para não instalar um pacote de servidor por causa de uma
 * revisão.
 *
 * Suporta Range: sem isso o navegador não consegue buscar posições no
 * vídeo, e conferir um trecho específico vira reproduzir tudo de novo.
 */
const here = fileURLToPath(new URL(".", import.meta.url));
const ROOTS = [here, join(here, "..", "out")];
const PORT = Number(process.env.PORT ?? 4321);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
};

function resolve(urlPath) {
  // `normalize` no Windows devolve "\" para "/", então comparar com "/"
  // não funciona: é preciso remover os separadores ANTES e só então
  // decidir se sobrou algo além da raiz.
  const clean = normalize(decodeURIComponent(urlPath.split("?")[0])).replace(/^(\.\.[/\\])+/, "");
  const stripped = clean.replace(/^[/\\]+/, "");
  const rel = stripped.length === 0 ? "index.html" : stripped;
  for (const root of ROOTS) {
    const candidate = join(root, rel);
    if (!candidate.startsWith(root)) continue;
    try {
      const stat = statSync(candidate);
      if (stat.isFile()) return { path: candidate, size: stat.size };
    } catch {
      // segue para a próxima raiz
    }
  }
  return null;
}

createServer((req, res) => {
  const found = resolve(req.url ?? "/");
  if (!found) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("nao encontrado");
    return;
  }

  const type = TYPES[extname(found.path).toLowerCase()] ?? "application/octet-stream";
  const range = req.headers.range;

  if (range) {
    const match = /bytes=(\d*)-(\d*)/.exec(range);
    const start = match?.[1] ? Number(match[1]) : 0;
    const end = match?.[2] ? Number(match[2]) : found.size - 1;
    res.writeHead(206, {
      "content-type": type,
      "content-range": `bytes ${start}-${end}/${found.size}`,
      "accept-ranges": "bytes",
      "content-length": end - start + 1,
      "cache-control": "no-store",
    });
    createReadStream(found.path, { start, end }).pipe(res);
    return;
  }

  res.writeHead(200, {
    "content-type": type,
    "content-length": found.size,
    "accept-ranges": "bytes",
    "cache-control": "no-store",
  });
  createReadStream(found.path).pipe(res);
}).listen(PORT, () => {
  console.log(`preview do product film em http://localhost:${PORT}`);
});
