import JSZip from 'jszip'

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

  const blob = await zip.generateAsync({ type: 'blob' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')

  try {
    anchor.href = url
    anchor.download = zipFilename
    document.body.appendChild(anchor)
    anchor.click()
  } finally {
    document.body.removeChild(anchor)
    URL.revokeObjectURL(url)
  }
}
