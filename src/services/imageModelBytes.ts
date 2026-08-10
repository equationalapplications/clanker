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
 */

import { getCharacterImageById } from '~/database/characterImageDatabase'
import { resolveImageUri } from '~/services/localImageStore'
import { isAttachmentMimeType, type AttachmentMimeType } from '../../shared/cloudAgentAttachments'

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

    return { mimeType: row.mime_type, data }
  } catch (err) {
    console.warn('Failed to load image bytes for the model:', imageId, err)
    return null
  }
}