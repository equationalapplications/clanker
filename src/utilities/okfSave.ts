import JSZip from 'jszip'
import { InteractionManager, Platform } from 'react-native'
import { File, Paths } from 'expo-file-system'
import { EncodingType, StorageAccessFramework, writeAsStringAsync } from 'expo-file-system/legacy'
import * as Sharing from 'expo-sharing'

export interface ZipOptions {
  characterName: string
  files: { path: string; content: string }[]
}

export type OkfSaveLocation = 'documents' | 'share' | 'download'

export interface OkfSaveResult {
  saveLocation: OkfSaveLocation
}

export class OkfSaveCancelledError extends Error {
  constructor() {
    super('Export cancelled')
    this.name = 'OkfSaveCancelledError'
  }
}

function buildZipFilename(characterName: string): string {
  const dateStr = new Date().toISOString().split('T')[0]
  const safeName = characterName.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 80) || 'character'
  return `${safeName}_${dateStr}.okf.zip`
}

async function waitForNativeUiReady(): Promise<void> {
  await new Promise<void>((resolve) => {
    InteractionManager.runAfterInteractions(() => resolve())
  })
}

async function shareFromCache(bytes: Uint8Array, zipFilename: string): Promise<void> {
  const output = new File(Paths.cache, zipFilename)
  output.write(bytes)

  try {
    await Sharing.shareAsync(output.uri, {
      mimeType: 'application/zip',
      dialogTitle: `Share ${zipFilename}`,
    })
  } finally {
    await output.delete()
  }
}

function getAndroidFolderPickerInitialUri(): string {
  const androidApi =
    typeof Platform.Version === 'number'
      ? Platform.Version
      : parseInt(String(Platform.Version), 10)

  // Android 11+ blocks OPEN_DOCUMENT_TREE on the Downloads root.
  if (!Number.isNaN(androidApi) && androidApi < 30) {
    return StorageAccessFramework.getUriForDirectoryInRoot('Download')
  }

  return StorageAccessFramework.getUriForDirectoryInRoot('Documents')
}

async function saveOkfToAndroidDevice(
  zipBase64: string,
  zipFilename: string,
): Promise<'saved' | 'cancelled'> {
  await waitForNativeUiReady()

  const initialUri = getAndroidFolderPickerInitialUri()
  const permissions = await StorageAccessFramework.requestDirectoryPermissionsAsync(initialUri)

  if (!permissions.granted) {
    return 'cancelled'
  }

  const fileUri = await StorageAccessFramework.createFileAsync(
    permissions.directoryUri,
    zipFilename,
    'application/zip',
  )

  await writeAsStringAsync(fileUri, zipBase64, { encoding: EncodingType.Base64 })
  return 'saved'
}

export async function zipAndSaveOKF(options: ZipOptions): Promise<OkfSaveResult> {
  const { characterName, files } = options
  const zipFilename = buildZipFilename(characterName)

  const zip = new JSZip()
  for (const file of files) {
    zip.file(file.path, file.content)
  }

  if (Platform.OS === 'android') {
    const zipBase64 = await zip.generateAsync({ type: 'base64' })
    const saveResult = await saveOkfToAndroidDevice(zipBase64, zipFilename)
    if (saveResult === 'saved') {
      return { saveLocation: 'documents' }
    }

    throw new OkfSaveCancelledError()
  }

  const bytes = await zip.generateAsync({ type: 'uint8array' })
  const canShare = await Sharing.isAvailableAsync()
  if (!canShare) {
    throw new Error('Sharing is not available on this device')
  }

  await shareFromCache(bytes, zipFilename)
  return { saveLocation: 'share' }
}
