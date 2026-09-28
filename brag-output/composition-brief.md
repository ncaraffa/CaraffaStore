# Hyperframes Composition Brief: CaraffaStore

## Objective
Create a short launch-style brag video for CaraffaStore (announcement video, Brazilian Portuguese on screen).

## Output
- Composition directory: `brag-output/composition/`
- Rendered video: `brag-output/brag.mp4`
- Format: landscape — 1920x1080, 30fps
- Duration: 21.6 seconds

## Source Material
- Project root: repository root
- Primary files read: `README.md`, `components/marketing/LandingPage.tsx`, `app/globals.css`, `components/ui/Logo.tsx`, `lib/config/site.ts`, and the existing product-film recreations in `video/src/components/` (StorefrontScreens, DashboardScreens, ProductArt, Brand)
- Product name: CaraffaStore
- Tagline / strongest claim: "Do catálogo ao Pix na sua conta." / "Sem comissão sobre o que você vende."
- Key UI to recreate: public storefront catalog (`app/loja/[storeSlug]`), Pix payment screen, dashboard order row
- Copy that must appear verbatim:
  - Do catálogo ao Pix na sua conta.
  - Um link, sua loja inteira
  - Pagamento confirmado!
  - Sem comissão por venda.
  - Criar minha loja

## Creative Direction
- Tone preset: default
- Creative direction: anúncio de lançamento brasileiro, limpo e confiante
- Interpretation: 6 short scenes, soft transitions, light canvas; energy from motion and product action, not jokes.
- Angle: follow one real sale end to end — link → catalog → cart → Pix confirmed → paid order — and land on "Comissão da CaraffaStore R$ 0,00".
- Hook: the site headline, word by word, huge.
- Outro / punchline: logo + "Sem comissão por venda." + "Planos a partir de R$ 30/mês" + "Criar minha loja".
- Avoid: generic SaaS language, abstract filler, redesigning the product UI, invented metrics or testimonials.

## Visual Identity
- Background: #f7f9fd (surface), cards #ffffff, lines #e4eaf4 / #cfd9ea
- Text: #0c1b33 (ink), #33425c (body), #64728e (muted — minimum for readable text)
- Accent: #1b4dff; ramp #2e6bff → #143bd1; soft #dee9ff / #f0f5ff
- Success: #0e9f6e, bg #ecfdf5, text #06603f, border #a7f3d0
- Display font: Bricolage Grotesque (local @font-face)
- Body font: Inter; mono JetBrains Mono (local @font-face)
- Visual references: jar mark with level line (exact SVG path from Logo.tsx), cobalt gradient tile, bluish shadows (rgba(12,27,51,…)), never black shadows.

## Storyboard
Use `brag-output/brag-plan.md` as the creative contract.

1. Hook — 0.00–3.70 — "Do catálogo ao Pix na sua conta."
2. Um link — 3.70–6.34 — logo + typed store link
3. Loja — 6.34–10.54 — Casa do Café catalog, 4 cards, click "Adicionar", cart 0→1
4. Pix — 10.54–14.76 — phone Pix R$ 39,90 → "Pagamento confirmado!"
5. R$ 0,00 — 14.76–17.91 — order #1042 Pago + commission receipt
6. Outro — 17.91–21.60 — logo, claim, price, CTA

## Audio
- Audio role: warm upbeat bed + moderate motion-matched SFX
- Audio arc: music from frame 0, steady; accents on the Pix seal and the R$ 0,00; fade out under the final logo
- Music: `assets/music/happy-beats-business-moves-vol-9-by-ende-dot-app.mp3`
- Music treatment: ~0.34 volume, fade-out last ~1.2s
- Music cue guidance: bundled preset `happy-beats-business-moves-vol-9-by-ende-dot-app.music-cues.json`; strong cues 3.70 / 6.34 / 12.65; card beats 6.86, 7.40, 7.92, 8.44
- Audio-reactive treatment: subtle; background accent glow and logo tile presence breathe with bass
- Audio-coupled moments: link typing (keys), product cards (card-place), cursor click, Pix seal (bell), R$ 0,00 (soft impact), final logo (bell)
- SFX analysis guidance: `.claude/skills/brag/assets/sfx/sfx-analysis.md` — prefer low HF-risk files
- Exact SFX choice: chosen after the animation exists
