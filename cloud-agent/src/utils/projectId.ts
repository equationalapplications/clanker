/**
 * Single source of truth for resolving the GCP project id from the
 * environment.
 *
 * Accepts all three project env names so the same Vertex caller works under
 * docker-compose.local.yml (which sets GOOGLE_CLOUD_PROJECT) and on Cloud Run
 * (which also sets GOOGLE_CLOUD_PROJECT in this project). Trims and skips
 * whitespace-only candidates so a stray "  " in a higher-priority variable
 * falls through rather than silently short-circuiting the chain to an empty
 * string.
 *
 * Callers throw their own error type when this returns undefined — the two
 * runtimes surface missing config differently (plain Error here, HttpsError in
 * functions/), so this helper deliberately does not throw.
 *
 * functions/ carries its own copy at functions/src/services/projectId.ts: that
 * package's tsconfig sets rootDir to "src" and does not include ../shared, so a
 * genuinely shared module would break its build and relocate the deployed
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
