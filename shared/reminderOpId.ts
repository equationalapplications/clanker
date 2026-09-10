/**
 * Canonical string hashed into a `set_reminder` operation id.
 *
 * Shared deliberately: BOTH set_reminder entry points — the cloud-agent
 * escalation tool and the client's edge executor — must hash IDENTICAL bytes,
 * or the opIds disagree and the server's `ON CONFLICT DO NOTHING` stops
 * collapsing a retry onto the existing row. The sweep would then fire the same
 * reminder twice. A duplicated copy per package makes that divergence a silent
 * one-line edit away, and no per-package test can catch it because each only
 * ever checks its own copy against itself.
 *
 * `deriveOpId` itself is NOT shared and cannot be: the client hashes with
 * expo-crypto (async, Hermes-safe) and cloud-agent with node:crypto. Only the
 * byte-for-byte input to those hashes lives here, which is the part that has
 * to agree.
 *
 * `remindAt` is the RAW ISO string from the model — NOT a parsed Date —
 * because Date#toISOString normalises the offset to "Z" while the edge input
 * may carry "+02:00", and the two would hash differently for the same
 * wall-clock moment.
 */
export function reminderOpIdCanonical(args: {
  characterId: string
  reason: string
  remindAt: string
  priority?: number
}): string {
  return `${args.characterId}|${args.reason.trim()}|${args.remindAt}|${args.priority ?? 0}`
}
