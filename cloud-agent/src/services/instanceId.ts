// Per-container identity. K_REVISION identifies a deployment revision, not a
// container; this UUID is generated once per process for true per-instance tracking.
export const INSTANCE_ID = crypto.randomUUID()
