import { File } from 'expo-file-system'
import { EncodingType, StorageAccessFramework, writeAsStringAsync } from 'expo-file-system/legacy'
import * as Sharing from 'expo-sharing'
import { OkfSaveCancelledError, zipAndSaveOKF } from '../okfSave'

let mockPlatformOS = 'ios'
let mockPlatformVersion: string | number = 29
const mockZipFile = jest.fn()
const mockGenerateAsync = jest.fn()
const mockFileWrite = jest.fn()

jest.mock('react-native', () => ({
  InteractionManager: {
    runAfterInteractions: (callback: () => void) => callback(),
  },
  Platform: {
    get OS() {
      return mockPlatformOS
    },
    get Version() {
      return mockPlatformVersion
    },
  },
}))

jest.mock('jszip', () =>
  jest.fn().mockImplementation(() => ({
    file: mockZipFile,
    generateAsync: mockGenerateAsync,
  })),
)

jest.mock('expo-file-system', () => ({
  __esModule: true,
  File: jest.fn().mockImplementation(() => ({
    uri: 'file://cache/bundle.okf.zip',
    write: mockFileWrite,
  })),
  Paths: { cache: 'file://cache' },
}))

jest.mock('expo-file-system/legacy', () => ({
  __esModule: true,
  EncodingType: { Base64: 'base64', UTF8: 'utf8' },
  StorageAccessFramework: {
    createFileAsync: jest.fn(),
    getUriForDirectoryInRoot: jest.fn((folderName: string) => `content://root/${folderName}`),
    requestDirectoryPermissionsAsync: jest.fn(),
  },
  writeAsStringAsync: jest.fn(),
}))

jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(),
  shareAsync: jest.fn(),
}))

const mockSharing = jest.mocked(Sharing)
const MockFile = jest.mocked(File)
const mockStorageAccessFramework = jest.mocked(StorageAccessFramework)
const mockLegacyWriteAsStringAsync = jest.mocked(writeAsStringAsync)

describe('zipAndSaveOKF', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockPlatformOS = 'ios'
    mockPlatformVersion = 29
    mockGenerateAsync.mockImplementation(async ({ type }: { type: string }) =>
      type === 'base64' ? 'zip-base64' : new Uint8Array([1, 2, 3]),
    )
    mockStorageAccessFramework.getUriForDirectoryInRoot.mockImplementation(
      (folderName: string) => `content://root/${folderName}`,
    )
    mockStorageAccessFramework.requestDirectoryPermissionsAsync.mockResolvedValue({
      granted: true,
      directoryUri: 'content://picked-dir',
    })
    mockStorageAccessFramework.createFileAsync.mockResolvedValue(
      'content://picked-dir/bundle.okf.zip',
    )
    mockSharing.isAvailableAsync.mockResolvedValue(true)
  })

  it('writes Android SAF exports through the legacy base64 writer', async () => {
    mockPlatformOS = 'android'

    const result = await zipAndSaveOKF({
      characterName: 'Clanker',
      files: [{ path: 'index.md', content: '# Clanker' }],
    })

    expect(result).toEqual({ saveLocation: 'documents' })
    expect(mockGenerateAsync).toHaveBeenCalledWith({ type: 'base64' })
    expect(mockLegacyWriteAsStringAsync).toHaveBeenCalledWith(
      'content://picked-dir/bundle.okf.zip',
      'zip-base64',
      { encoding: EncodingType.Base64 },
    )
    expect(MockFile).not.toHaveBeenCalledWith('content://picked-dir/bundle.okf.zip')
  })

  it('treats Android folder picker cancellation as an abort', async () => {
    mockPlatformOS = 'android'
    mockStorageAccessFramework.requestDirectoryPermissionsAsync.mockResolvedValue({
      granted: false,
    })

    await expect(
      zipAndSaveOKF({
        characterName: 'Clanker',
        files: [{ path: 'index.md', content: '# Clanker' }],
      }),
    ).rejects.toBeInstanceOf(OkfSaveCancelledError)

    expect(mockSharing.isAvailableAsync).not.toHaveBeenCalled()
    expect(mockSharing.shareAsync).not.toHaveBeenCalled()
  })
})
