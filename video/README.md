# Product film da CaraffaStore

Filme de produto de 30 s para a landing, feito em [Remotion](https://remotion.dev).

**Projeto isolado de propósito.** Tem `package.json`, `node_modules` e
`tsconfig` próprios: nada daqui entra no bundle da aplicação, e o build de
produção não passa a depender da toolchain de vídeo. A aplicação não importa
nada de `video/`, e `video/` não importa nada da aplicação — os tokens e as
telas são reproduzidos, não acoplados (ver `src/lib/theme.ts`).

## Rodar

```bash
cd video
npm install
npm run studio        # editor visual, com scrub na timeline
```

## Renderizar

```bash
cd video
npm run render:all    # master, web, webm e poster
```

Ou individualmente:

| Comando | Saída |
| --- | --- |
| `npm run render:master` | `out/caraffastore-product-film-master.mp4` — H.264 CRF 16 |
| `npm run render:web` | `out/caraffastore-product-film-web.mp4` — H.264 CRF 27 |
| `npm run render:webm` | `out/caraffastore-product-film.webm` — VP9 CRF 34 |
| `npm run render:poster` | `out/caraffastore-product-film-poster.png` |

`out/` é ignorado pelo Git: são binários grandes e reproduzíveis por comando.
Quando o vídeo for de fato para a landing, o arquivo escolhido é copiado para
`public/` numa task própria.

## Conferir antes de aprovar

```bash
cd video
node preview/serve.mjs   # http://localhost:4321
```

A página reproduz o filme com `autoplay muted loop playsInline`, exatamente
como ficaria na landing, e permite alternar entre as três versões renderizadas.

## Estrutura

```
src/
  Root.tsx                 registro da composição (1920x1080, 30 fps, 900 frames)
  ProductFilm.tsx          a timeline: onde cada cena começa e por quanto dura
  lib/
    theme.ts               tokens copiados de app/globals.css
    timing.ts              curvas de easing e helpers de entrada
    fonts.ts               as três fontes do site, carregadas localmente
  components/              molduras, telas reproduzidas, cursor, marca, arte
  scenes/                  uma cena por arquivo, na ordem do roteiro
preview/                   página e servidor estático só para revisão
```

## Regra de conteúdo

O filme só mostra o que a CaraffaStore faz hoje. Sem domínio próprio, sem logo
ou capa por loja, sem tema personalizável, sem gráfico de analytics, sem
pagamento por cartão — nada disso existe no produto. Os dados (Casa do Café,
pedido #1042) são demonstrativos e não vêm do banco.
