/**
 * Re-obtains a saved image's base64 for a model call.
 *
 * The first send holds the master base64 in memory — it was just encoded, and a
 * Storage round-trip would make the reply wait on an upload it does not need.
 * This is the *retry* path: a `cloud`-kind row's local bytes are deleted once
 * uploaded, so after an app restart the resolver is the only thing that can
 * produce them again. That re-encode is accepted for how rare a cold retry of a
 * failed vision turn is; caching base64 across restarts would put a second copy
 * of user photo content in a second place with its own lifecycle.
 *
 * Returns null on every failure. A vision retry that cannot find its bytes must
 * degrade to a plain text turn's error handling, not crash the send.
 *
 * The encoded length is re-checked against `MAX_ATTACHMENT_BASE64_CHARS` here
 * even though the picker path enforces it at upload time: a row may have
 * predated the cap, or a future cap change could leave legacy rows over the
 * new bound. Failing fast at the resolver means the server never sees a doomed
 * payload.
 *
 * **Current status: scaffolding.** Per the spec §13 "Cold retry after app
 * restart is not implemented", `PendingChatPhoto` lives in memory only and
 * `sendPhoto` never calls `getImageAttachment` today. This module exists so
 * that when a durable retry queue lands, the resolver is already present and
 * covered by tests — calling it from `sendPhoto`'s cold-retry branch is the
 * follow-up, not this phase.
 */

import { getCharacterImageById } from '~/database/characterImageDatabase'
import { resolveImageUri } from '~/services/localImageStore'
import {
  isAttachmentMimeType,
  MAX_ATTACHMENT_BASE64_CHARS,
  type AttachmentMimeType,
} from '../../shared/cloudAgentAttachments'

export interface ImageAttachment {
  mimeType: AttachmentMimeType
  data: string
}

async function base64FromUri(uri: string): Promise<string | null> {
  if (uri.startsWith('data:')) {
    const comma = uri.indexOf(',')
    return comma === -1 ? null : uri.slice(comma + 1)
  }

  const response = await fetch(uri)
  if (!response.ok) return null
  const blob = await response.blob()

  return await new Promise<string | null>((resolve) => {
    const reader = new FileReader()
    reader.onerror = () => resolve(null)
    reader.onloadend = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      const comma = result.indexOf(',')
      resolve(comma === -1 ? null : result.slice(comma + 1))
    }
    reader.readAsDataURL(blob)
  })
}

export async function getImageAttachment(imageId: string): Promise<ImageAttachment | null> {
  try {
    const row = await getCharacterImageById(imageId)
    if (!row) return null
    // The mime type is client-supplied data that round-tripped through the cloud.
    // Re-check it here rather than trusting the row: the same value drives
    // data-URI construction on web, and the agent contract admits only two types.
    if (!isAttachmentMimeType(row.mime_type)) return null

    const uri = await resolveImageUri(row, 'master')
    if (!uri) return null

    const data = await base64FromUri(uri)
    if (!data) return null

    // Same bound the picker enforces, applied here so a legacy/over-cap row
    // returns null instead of producing a 400 mid-send. See module docstring.
    if (data.length > MAX_ATTACHMENT_BASE64_CHARS) {
      console.warn('Image exceeds attachment cap, refusing to retry:', imageId, data.length)
      return null
    }

    return { mimeType: row.mime_type, data }
  } catch (err) {
    console.warn('Failed to load image bytes for the model:', imageId, err)
    return null
  }
}