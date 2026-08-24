// Chat image generation (agent generate_image tool) — spec:
// docs/superpowers/specs/2026-08-23-agent-image-generation-design.md §6.4.
// Primary: Nano Banana Lite tier (~1K native output matches the client's
// 1024-master/256-thumb variant pipeline; lowest latency/cost).
// Fallback (documented, swap = one-line change): 'gemini-2.5-flash-image'
// — today's prod avatar model in functions/src/generateImage.ts.
// Spike-verified live 2026-08-24 against clanker-prod: the Lite SKU answers in
// the `global` region only (us-central1 returns 404 NOT_FOUND while the
// fallback answers there), so the region pin is `global` — the same default
// db/embeddings.ts already uses. Per-image price (official Gemini pricing
// page, checked 2026-08-24): $30/1M image tokens ≈ $0.0336 per 1K image
// (1120 tokens); input $0.25/M, text output $1.50/M.
export const CHAT_IMAGE_MODEL_ID = 'gemini-3.1-flash-lite-image'
export const CHAT_IMAGE_REGION = 'global'
