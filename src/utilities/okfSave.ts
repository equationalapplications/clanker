import JSZip from 'jszip'
import { File, Paths } from 'expo-file-system'
import * as Sharing from 'expo-sharing'

export interface ZipOptions {
  characterName: string
  files: { path: string; content: string }[]
}

function buildZipFilename(characterName: string): string {
  const dateStr = new Date().toISOString().split('T')[0]
  const safeName = characterName.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 80) || 'character'
  return `${safeName}_${dateStr}.okf.zip`
}

export async function zipAndSaveOKF(options: ZipOptions): Promise<void> {
  const { characterName, files } = options
  const zipFilename = buildZipFilename(characterName)

  const zip = new JSZip()
  for (const file of files) {
    zip.file(file.path, file.content)
  }

  const canShare = await Sharing.isAvailableAsync()
  if (!canShare) {
    throw new Error('Sharing is not available on this device')
  }

  const bytes = await zip.generateAsync({ type: 'uint8array' })
  const output = new File(Paths.cache, zipFilename)
  output.write(bytes)

  try {
    await Sharing.shareAsync(output.uri, {
      mimeType: 'application/zip',
      dialogTitle: `Share ${zipFilename}`,
    })
  } finally {
    try {
      output.delete()
    } catch (cleanupErr) {
      console.warn('Failed to clean up OKF export zip:', cleanupErr)
    }
  }
