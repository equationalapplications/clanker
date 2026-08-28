/**
 * Single source of truth for resolving the GCP project id from the
 * environment.
 *
 * Accepts all three project env names so the same Vertex caller works locally
 * and on Cloud Functions. Trims and skips whitespace-only candidates so a stray
 * "  " in a higher-priority variable falls through rather than silently
 * short-circuiting the chain to an empty string.
 *
 * Callers throw their own error type when this returns undefined — the two
 * runtimes surface missing config differently (HttpsError here, plain Error in
 * cloud-agent/), so this helper deliberately does not throw.
 *
 * cloud-agent/ carries its own copy at cloud-agent/src/utils/projectId.ts: this
 * package's tsconfig sets rootDir to "src" and does not include ../shared, so a
 * genuinely shared module would break the build and relocate the deployed
 * lib/index.js entry point.
 */
export function resolveProjectId(): string | undefined {
  for (const value of [
    process.env.GCLOUD_PROJECT,
    process.env.GCP_PROJECT,
    process.env.GOOGLE_CLOUD_PROJECT,
  ]) {
    const project = value?.trim()
    if (project) return project
  }
  return undefined
}
