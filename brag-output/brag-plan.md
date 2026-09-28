# Brag Plan: CaraffaStore

## What is this app?
Uma loja virtual para pequenos comerciantes: monta o catálogo, manda o link no WhatsApp e recebe cada pedido por Pix direto na própria conta do Mercado Pago — sem comissão sobre a venda.

## The angle
Anúncio de lançamento brasileiro, direto ao ponto: o vídeo percorre o caminho real de uma venda — link → catálogo → carrinho → Pix confirmado → pedido no painel — e termina no único número que importa para o lojista: **comissão da CaraffaStore: R$ 0,00**. A loja de exemplo é a "Casa do Café" (a mesma loja fictícia do filme de produto já existente em `video/`), com os produtos e preços que o projeto já usa.

## Hook (first 2-3 seconds)
A manchete verbatim do site, em tipografia gigante, entrando palavra por palavra: **"Do catálogo ao Pix na sua conta."** — com "Pix na sua conta" em azul de ação. É a promessa inteira em 7 palavras.

## Key moments (the middle)
- O link da loja sendo digitado (`caraffastore.vercel.app/loja/casa-do-cafe`) e virando a loja.
- Catálogo da Casa do Café: 4 cards de produto chegam um a um; o cursor clica "Adicionar" no Café Especial 500 g, o botão vira "Adicionado" e o carrinho vai de 0 para 1.
- Celular com o Pix de R$ 39,90 → selo verde "Pagamento confirmado", chip "Pix recebido".
- O pedido aparece no painel como "Pago" e a linha "Comissão da CaraffaStore — R$ 0,00" bate na tela.

## Outro / punchline
Logo CaraffaStore + "Sem comissão por venda." + "Planos a partir de R$ 30/mês" + botão "Criar minha loja".

## User flow worth showing
Cliente abre o link → adiciona ao carrinho (sem criar conta) → paga o Pix → lojista vê o pedido pago no painel.

## Tone
- Preset: default
- Creative direction: anúncio de lançamento brasileiro, limpo e confiante, feito para postar no Instagram/LinkedIn/WhatsApp
- Interpretation: ritmo animado com 6 cenas curtas e transições suaves; nada de piada forçada — o "uau" vem do R$ 0,00. Visual claro (branco + azul cobalto), como o próprio produto.

## Format: landscape — 1920x1080
## Duration: 21.6s

## Visual identity (from the project)
- Background: #f7f9fd (surface) / #ffffff (cards)
- Accent: #1b4dff (azul de ação), rampa #2e6bff → #143bd1
- Text: #0c1b33 (ink), #33425c (body), #64728e (muted)
- Success: #0e9f6e / bg #ecfdf5 / text #06603f
- Display font: Bricolage Grotesque
- Body font: Inter (mono: JetBrains Mono para rótulos e códigos)
- Strongest visual element: a jarra da marca com a "linha de nível", o selo cobalto do logo, e o card de produto da loja pública

## Share copy (draft)
Do catálogo ao Pix na sua conta: a CaraffaStore monta sua loja virtual, seu cliente paga por Pix direto no seu Mercado Pago, e a comissão da plataforma é R$ 0,00.

## Audio direction
- Role: warm upbeat bed + moderate motion-matched SFX
- Music: `happy-beats-business-moves-vol-9-by-ende-dot-app.mp3` (114.84 BPM)
- Music treatment: volume ~0.34, fade-in curto, fade-out nos últimos ~1.2s sob o logo
- Music cue guidance: preset `assets/music/cues/happy-beats-business-moves-vol-9-by-ende-dot-app.music-cues.json`. Strong cues: 3.70s (reveal da marca), 6.34s (entra o catálogo), 12.65s (Pix confirmado). Beat grid para os 4 cards: 6.86 / 7.40 / 7.92 / 8.44 (cards são visuais; o conjunto fica parado depois para leitura).
- Audio-reactive treatment: subtle; o brilho azul do fundo e a presença do selo do logo respiram com o grave. Sem visualizador.
- SFX posture: moderate, motion-matched, suaves (baixo risco de agudos)
- Audio-coupled moments: digitação do link (teclas), cards chegando, clique do cursor, selo do Pix, R$ 0,00, logo final
- Restraint rule: nenhum som agressivo; repetições (teclas, cards) ficam baixas e no fundo.

## Storyboard

### Scene 1 — Hook — 0.00–3.70s (3.7s)
"Do catálogo ao Pix na sua conta." em Bricolage gigante, palavra por palavra; "Pix na sua conta" em #1b4dff. Rótulo mono pequeno acima: "LOJA VIRTUAL PARA PEQUENOS COMERCIANTES".
Sequential/interaction: palavras entram uma a uma (~0.12s entre elas), frase inteira parada ≥ 2.1s.
Audio intent: abrir com energia e clareza.
Audio-coupled idea: toque suave na entrada da frase.
Music: entra já no frame 0.
Transition mood: soft → Scene 2

### Scene 2 — Um link, sua loja inteira — 3.70–6.34s (2.64s)
Selo do logo + "CaraffaStore" assentam (beat-locked 3.70). Abaixo, uma barra de endereço onde o link `caraffastore.vercel.app/loja/casa-do-cafe` é digitado. Legenda: "Um link, sua loja inteira."
Sequential/interaction: digitação caractere a caractere.
Audio intent: marca + ação.
Audio-coupled idea: teclas baixas durante a digitação; drop suave quando o logo assenta.
Transition mood: clean (a barra de endereço vira a janela da loja) → Scene 3

### Scene 3 — A loja do cliente — 6.34–10.54s (4.2s)
Janela de navegador com a loja pública "Casa do Café": rótulo "Catálogo", "4 produtos em 3 categorias", chips Todas/Grãos/Acessórios/Presentes, 4 cards (Café Especial 500 g R$ 39,90; Coador Artesanal R$ 29,90; Caneca Casa do Café R$ 34,90; Moedor Manual R$ 89,90). Cursor clica "Adicionar" no Café Especial → "Adicionado", carrinho 0 → 1. Legenda lateral/topo: "Seu cliente compra sem criar conta."
Sequential/interaction: cards um a um no beat grid; clique simulado ~9.0s.
Audio intent: movimento de produto, leve.
Audio-coupled idea: card-place nos cards (acento no 1º e no último), clique do mouse.
Transition mood: soft → Scene 4

### Scene 4 — Pix na hora — 10.54–14.76s (4.22s)
Celular com a tela de Pix: "Pague com Pix", valor R$ 39,90, QR Code, "Copia e cola". Em 12.65 (beat-locked) o selo verde assenta sobre o QR: "Pagamento confirmado". Ao lado: chip "Pix recebido" + "Direto na sua conta do Mercado Pago."
Sequential/interaction: QR → aprovado.
Audio intent: o momento de recompensa.
Audio-coupled idea: sino/chips suave no selo.
Transition mood: soft → Scene 5

### Scene 5 — R$ 0,00 — 14.76–17.91s (3.15s)
Painel do lojista: linha de pedido "#1042 · Marina Alves · Café Especial 500 g · R$ 39,90 · Pago" (nome fictício). Abaixo, recibo: "Venda R$ 39,90" / "Comissão da CaraffaStore R$ 0,00" — o R$ 0,00 cresce e ganha destaque.
Sequential/interaction: linha do pedido entra, depois o recibo linha a linha.
Audio intent: punch.
Audio-coupled idea: impacto suave no R$ 0,00.
Transition mood: soft → Scene 6

### Scene 6 — Outro — 17.91–21.60s (3.69s)
Logo CaraffaStore grande (beat 17.91), "Sem comissão por venda.", "Planos a partir de R$ 30/mês", botão "Criar minha loja", endereço caraffastore.vercel.app.
Audio intent: fechamento confiante; música desce no fim.
Audio-coupled idea: sino final no logo.
Transition mood: fim em frame limpo (não termina em preto).

**Music mood for this video:** upbeat
**Audio summary:** uma batida alegre de negócios do início ao fim, com poucos sons de interface acompanhando o que a tela faz, e um sino no Pix e no logo.

Nota de privacidade: nenhum dado real. "Casa do Café", "Marina Alves", o número do pedido e os produtos são fictícios — os mesmos já usados pelo filme de produto do repositório.
