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

## Duas composições

| Composição | Formato | Onde entra |
| --- | --- | --- |
| `CaraffaStoreProductFilmDesktop` | 1920×1080 (16:9) | bloco largo da landing no desktop |
| `CaraffaStoreProductFilmMobile` | 1080×1350 (4:5) | mesmo bloco no celular |

As duas têm o **mesmo roteiro, os mesmos dados e o mesmo relógio** (900
frames, 30 fps). O que muda é o enquadramento — a vertical **não é um corte**
da horizontal. O motivo está medido em `src/components/MobileStage.tsx`: um
celular de 390px exibindo um vídeo de 1080px reduz tudo por 0,36, então a
interface real de 14px sairia com 5px. A versão vertical monta as telas na
largura de um celular e amplia o bloco por 2,4.

## Renderizar

```bash
cd video
npm run render:all       # desktop + mobile
npm run render:desktop   # só 16:9
npm run render:mobile    # só 4:5
```

| Saída | Codec |
| --- | --- |
| `*-desktop-master.mp4` / `*-mobile-master.mp4` | H.264 CRF 16 |
| `*-desktop-web.mp4` / `*-mobile-web.mp4` | H.264 CRF 27 |
| `*-desktop.webm` / `*-mobile.webm` | VP9 CRF 34 |
| `*-desktop-poster.jpeg` / `*-mobile-poster.jpeg` | frame 0, qualidade 90 |

Todos os renders usam `--muted`: o Remotion adiciona uma trilha AAC silenciosa
por padrão, e ela sozinha pesava ~1,2 MB num filme que é explicitamente sem
áudio.

`out/` é ignorado pelo Git: são binários grandes e reproduzíveis por comando.
Quando o vídeo for de fato para a landing, o arquivo escolhido é copiado para
`public/` numa task própria.

## Conferir antes de aprovar

```bash
cd video
npm run preview   # http://localhost:4321
```

A página tem três abas — **Desktop 16:9**, **Mobile 4:5** e **Mobile numa tela
de 390px** — e permite alternar entre master, web e webm em cada uma. Tudo
reproduz com `autoplay muted loop playsInline`, como ficaria na landing.

## Estrutura

```
src/
  Root.tsx                 registro da composição (1920x1080, 30 fps, 900 frames)
  ProductFilm.tsx          a timeline: onde cada cena começa e por quanto dura
  lib/
    theme.ts               tokens copiados de app/globals.css
    timing.ts              curvas de easing e helpers de entrada
    fonts.ts               as três fontes do site, carregadas localmente
  ProductFilmMobile.tsx    a mesma timeline, no enquadramento vertical
  components/
    Stage.tsx              câmera do 16:9 (escala + foco em um ponto da tela)
    MobileStage.tsx        a régua do vertical: base de celular x 2,4
    MobileScreens.tsx      telas no layout mobile que a aplicação já serve
    ...                    molduras, cursor, marca, arte de produto
  scenes/                  cenas do 16:9, uma por arquivo
  scenes/mobile/           as mesmas cenas, recompostas para 4:5
preview/                   página e servidor estático só para revisão
```

## Regra de conteúdo

O filme só mostra o que a CaraffaStore faz hoje. Sem domínio próprio, sem logo
ou capa por loja, sem tema personalizável, sem gráfico de analytics, sem
pagamento por cartão — nada disso existe no produto. Os dados (Casa do Café,
pedido #1042) são demonstrativos e não vêm do banco.
