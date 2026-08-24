// Chat image generation (agent generate_image tool) — spec:
// docs/superpowers/specs/2026-08-23-agent-image-generation-design.md §6.4.
// Primary: Nano Banana Lite tier (~1K native output matches the client's
// 1024-master/256-thumb variant pipeline; lowest latency/cost).
// Fallback (documented, swap = one-line change): 'gemini-2.5-flash-image'
// — today's prod avatar model in functions/src/generateImage.ts.
// Per-image price (Vertex): ~$0.03 ballpark for the Lite tier — PENDING live
// spike verification; CHAT_IMAGE_MODEL_ID itself stays provisional until the
// spike re-runs before deploy (fallback swap = one-line change).
export const CHAT_IMAGE_MODEL_ID = 'gemini-3.1-flash-lite-image'
export const CHAT_IMAGE_REGION = 'us-central1'
