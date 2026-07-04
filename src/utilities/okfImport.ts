import * as DocumentPicker from 'expo-document-picker'
import { File } from 'expo-file-system'
import JSZip from 'jszip'

export interface OkfFile {
  path: string
  content: string
}

export class OkfPickCancelledError extends Error {
  constructor() {
    super('Import cancelled')
    this.name = 'OkfPickCancelledError'
  }
}

// Raw zip file size, checked before any decompression — mirrors the
// MAX_DOCUMENT_RAW_BYTES precedent at src/components/documentMimeTypes.ts:4,
// but larger: an OKF bundle is a zip archive of many small markdown files,
// not a single plain-text document.
export const MAX_OKF_ZIP_RAW_BYTES = 50_000_000

// A real OKF bundle is one file per fact/task plus a handful of index/log
// files. 5,000 comfortably covers any real character while rejecting a
// crafted zip with hundreds of thousands of empty entries.
export const MAX_OKF_ZIP_ENTRIES = 5_000

// Total decompressed content cap across all allow-listed entries — the real
// zip-bomb defense. Generous for any real character export (a few MB of
// markdown at most), tight enough to reject a crafted bomb.
export const MAX_OKF_TOTAL_UNCOMPRESSED_BYTES = 100_000_000

const OKF_PATH_PATTERN =
  /^(index\.md|entities\/[^/]+\/(index\.md|log\.md|facts\/[^/]+\.md|tasks\/[^/]+\.md))$/

function isAllowedOkfPath(path: string): boolean {
  return OKF_PATH_PATTERN.test(path)
}

function extractEntityId(path: string): string | null {
  const match = path.match(/^entities\/([^/]+)\//)
  return match ? match[1] : null
}

export async function pickAndReadOkfBundle(): Promise<OkfFile[]> {
  const pickerResult = await DocumentPicker.getDocumentAsync({
    copyToCacheDirectory: true,
    type: ['application/zip', 'application/x-zip-compressed'],
  })
  if (pickerResult.canceled || !pickerResult.assets?.[0]) {
    throw new OkfPickCancelledError()
  }

  const asset = pickerResult.assets[0]
  if (typeof asset.size === 'number' && asset.size > MAX_OKF_ZIP_RAW_BYTES) {
    throw new Error('Bundle too large or malformed')
  }

  const pickedFile = new File(asset.uri)
  const arrayBuffer = await pickedFile.arrayBuffer()
  const zip = await JSZip.loadAsync(arrayBuffer)

  const entries = Object.entries(zip.files).filter(([, entry]) => !entry.dir)
  if (entries.length > MAX_OKF_ZIP_ENTRIES) {
    throw new Error('Bundle too large or malformed')
  }

  // Fast pre-filter using JSZip's parsed central-directory metadata. This is
  // attacker-controlled header data — a crafted zip can lie about it — so it
  // only avoids decompression work for the obviously-oversized case. The
  // running actual-content-length check below is the real defense.
  let declaredTotal = 0
  for (const [path, entry] of entries) {
    if (!isAllowedOkfPath(path)) continue
    const declaredSize = (entry as unknown as { _data?: { uncompressedSize?: number } })._data
      ?.uncompressedSize
    if (typeof declaredSize === 'number') {
      declaredTotal += declaredSize
      if (declaredTotal > MAX_OKF_TOTAL_UNCOMPRESSED_BYTES) {
        throw new Error('Bundle too large or malformed')
      }
    }
  }

  const files: OkfFile[] = []
  const entityIds = new Set<string>()
  let actualTotal = 0

  for (const [path, entry] of entries) {
    if (!isAllowedOkfPath(path)) continue

    const content = await entry.async('string')
    actualTotal += content.length
    if (actualTotal > MAX_OKF_TOTAL_UNCOMPRESSED_BYTES) {
      throw new Error('Bundle too large or malformed')
    }

    const entityId = extractEntityId(path)
    if (entityId) entityIds.add(entityId)
    files.push({ path, content })
  }

  if (entityIds.size > 1) {
    throw new Error(
      "This bundle contains multiple characters — multi-character import isn't supported yet.",
    )
  }

  if (files.length === 0) {
    throw new Error("This doesn't look like a valid OKF backup.")
  }

  return files
}
