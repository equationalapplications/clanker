import {
  pickAndReadOkfBundle,
  OkfPickCancelledError,
  MAX_OKF_ZIP_RAW_BYTES,
  MAX_OKF_TOTAL_UNCOMPRESSED_BYTES,
} from '../okfImport'
import * as DocumentPicker from 'expo-document-picker'
import { File } from 'expo-file-system'
import JSZip from 'jszip'

jest.mock('expo-document-picker', () => ({
  getDocumentAsync: jest.fn(),
}))

jest.mock('expo-file-system', () => ({
  File: jest.fn(),
}))

jest.mock('jszip', () => ({
  __esModule: true,
  default: { loadAsync: jest.fn() },
}))

const mockGetDocumentAsync = jest.mocked(DocumentPicker.getDocumentAsync)
const MockFile = jest.mocked(File)
const mockLoadAsync = jest.mocked(JSZip.loadAsync)

function mockZipEntry(content: string, declaredSize?: number) {
  return {
    dir: false,
    async: jest.fn().mockResolvedValue(content),
    _data: declaredSize !== undefined ? { uncompressedSize: declaredSize } : undefined,
  }
}

function setupPicker(size = 1000) {
  mockGetDocumentAsync.mockResolvedValue({
    canceled: false,
    assets: [{ uri: 'file://bundle.zip', size, name: 'bundle.zip' }],
  } as any)
  MockFile.mockImplementation(
    () =>
      ({
        arrayBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(8)),
      }) as any,
  )
}

function setupPickerWithoutSize(fileSize?: number) {
  mockGetDocumentAsync.mockResolvedValue({
    canceled: false,
    assets: [{ uri: 'file://bundle.zip', name: 'bundle.zip' }],
  } as any)
  const pickedFile = {
    size: fileSize,
    arrayBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(8)),
  }
  MockFile.mockImplementation(
    () =>
      pickedFile as any,
  )
  return pickedFile
}

describe('pickAndReadOkfBundle', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('throws OkfPickCancelledError when the picker is cancelled', async () => {
    mockGetDocumentAsync.mockResolvedValue({ canceled: true } as any)
    await expect(pickAndReadOkfBundle()).rejects.toBeInstanceOf(OkfPickCancelledError)
  })

  it('uses a wildcard picker type so Android providers can show valid zip bundles', async () => {
    setupPicker()
    mockLoadAsync.mockResolvedValue({
      files: { 'entities/char_1/facts/fact_a.md': mockZipEntry('---\nid: fact_a\n---\n') },
    } as any)

    await pickAndReadOkfBundle()

    expect(mockGetDocumentAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        copyToCacheDirectory: true,
        type: '*/*',
      }),
    )
  })

  it('rejects before reading when the raw file size exceeds the cap', async () => {
    setupPicker(MAX_OKF_ZIP_RAW_BYTES + 1)
    await expect(pickAndReadOkfBundle()).rejects.toThrow('Bundle too large or malformed')
    expect(mockLoadAsync).not.toHaveBeenCalled()
  })

  it('checks the cached file size before reading when picker size metadata is missing', async () => {
    const pickedFile = setupPickerWithoutSize(MAX_OKF_ZIP_RAW_BYTES + 1)

    await expect(pickAndReadOkfBundle()).rejects.toThrow('Bundle too large or malformed')

    expect(pickedFile.arrayBuffer).not.toHaveBeenCalled()
    expect(mockLoadAsync).not.toHaveBeenCalled()
  })

  it('rejects a crafted entry with a huge declared uncompressedSize without decompressing it', async () => {
    setupPicker()
    const bombEntry = mockZipEntry('x', MAX_OKF_TOTAL_UNCOMPRESSED_BYTES + 1)
    mockLoadAsync.mockResolvedValue({
      files: { 'entities/char_1/facts/fact_a.md': bombEntry },
    } as any)

    await expect(pickAndReadOkfBundle()).rejects.toThrow('Bundle too large or malformed')
    expect(bombEntry.async).not.toHaveBeenCalled()
  })

  it('catches a bundle whose actual decompressed content exceeds the cap even with no declared size', async () => {
    setupPicker()
    const hugeContent = 'x'.repeat(1000)
    mockLoadAsync.mockResolvedValue({
      files: { 'entities/char_1/facts/fact_a.md': mockZipEntry(hugeContent) },
    } as any)

    // Simulate a cap far smaller than the real constant so the test runs fast;
    // done by asserting the running-total code path directly via a bundle
    // that exceeds MAX_OKF_TOTAL_UNCOMPRESSED_BYTES using repeated entries
    // instead of one giant string (avoids allocating 100MB in the test).
    const manyEntries: Record<string, ReturnType<typeof mockZipEntry>> = {}
    const chunk = 'x'.repeat(1_000_000)
    const entriesNeeded = Math.ceil(MAX_OKF_TOTAL_UNCOMPRESSED_BYTES / chunk.length) + 1
    for (let i = 0; i < entriesNeeded; i++) {
      manyEntries[`entities/char_1/facts/fact_${i}.md`] = mockZipEntry(chunk)
    }
    mockLoadAsync.mockResolvedValue({ files: manyEntries } as any)

    await expect(pickAndReadOkfBundle()).rejects.toThrow('Bundle too large or malformed')
  })

  it('keeps only exact allow-listed OKF paths and drops a bundle-root README.md', async () => {
    setupPicker()
    mockLoadAsync.mockResolvedValue({
      files: {
        'index.md': mockZipEntry('# root'),
        'README.md': mockZipEntry('# readme junk'),
        'entities/char_1/index.md': mockZipEntry('# entity index'),
        'entities/char_1/log.md': mockZipEntry('# log'),
        'entities/char_1/facts/fact_a.md': mockZipEntry('---\nid: fact_a\n---\nBody'),
        'entities/char_1/tasks/task_a.md': mockZipEntry('---\nid: task_a\n---\n'),
      },
    } as any)

    const files = await pickAndReadOkfBundle()
    const paths = files.map((f) => f.path)
    expect(paths).toEqual(
      expect.arrayContaining([
        'index.md',
        'entities/char_1/index.md',
        'entities/char_1/log.md',
        'entities/char_1/facts/fact_a.md',
        'entities/char_1/tasks/task_a.md',
      ]),
    )
    expect(paths).not.toContain('README.md')
  })

  it('rejects a bundle containing more than one entities/{id}/ directory', async () => {
    setupPicker()
    mockLoadAsync.mockResolvedValue({
      files: {
        'entities/char_1/facts/fact_a.md': mockZipEntry('---\nid: fact_a\n---\n'),
        'entities/char_2/facts/fact_b.md': mockZipEntry('---\nid: fact_b\n---\n'),
      },
    } as any)

    await expect(pickAndReadOkfBundle()).rejects.toThrow(/multiple characters/)
  })

  it('rejects a bundle where no concept files survive filtering', async () => {
    setupPicker()
    mockLoadAsync.mockResolvedValue({
      files: { 'README.md': mockZipEntry('# junk only') },
    } as any)

    await expect(pickAndReadOkfBundle()).rejects.toThrow("doesn't look like a valid OKF backup")
  })

  it('rejects a zip with more entries than the entry-count cap', async () => {
    setupPicker()
    const files: Record<string, ReturnType<typeof mockZipEntry>> = {}
    for (let i = 0; i < 5001; i++) {
      files[`entities/char_1/facts/fact_${i}.md`] = mockZipEntry('x')
    }
    mockLoadAsync.mockResolvedValue({ files } as any)

    await expect(pickAndReadOkfBundle()).rejects.toThrow('Bundle too large or malformed')
  })
})
