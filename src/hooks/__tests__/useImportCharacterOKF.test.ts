import { renderHook, act } from '@testing-library/react-native'
import { useImportCharacterOKF } from '../useImportCharacterOKF'
import * as okfImport from '~/utilities/okfImport'
import * as okfImportRemap from '~/utilities/okfImportRemap'
import * as okfImportDedupe from '~/utilities/okfImportDedupe'

import { parseOkfBundle, WikiBusyError, useWiki } from '@equationalapplications/expo-llm-wiki'

jest.mock('~/utilities/okfImport')
jest.mock('~/utilities/okfImportRemap')
jest.mock('~/utilities/okfImportDedupe')
jest.mock('~/utilities/reportError', () => ({
  reportError: jest.fn(),
}))

jest.mock('@equationalapplications/expo-llm-wiki', () => {
  class MockWikiBusyError extends Error {
    operation: string
    entityId: string
    constructor(operation: string, entityId: string) {
      super(`Wiki busy: ${operation} on ${entityId}`)
      this.operation = operation
      this.entityId = entityId
      this.name = 'WikiBusyError'
    }
  }

  const mockImportDumpFn = jest.fn()
  const mockWiki = { importDump: mockImportDumpFn, exportDump: jest.fn() }
  return {
    useWiki: jest.fn(() => mockWiki),
    parseOkfBundle: jest.fn(),
    WikiBusyError: MockWikiBusyError,
  }
})

const mockPickAndReadOkfBundle = jest.mocked(okfImport.pickAndReadOkfBundle)
const mockParseOkfBundle = jest.mocked(parseOkfBundle)
const mockRemapOkfDumpIds = jest.mocked(okfImportRemap.remapOkfDumpIds)
const mockDedupeEventsAgainstExisting = jest.mocked(okfImportDedupe.dedupeEventsAgainstExisting)

// Get reference to mockImportDump from the mocked useWiki
const mockWiki = jest.mocked(useWiki)()
const mockImportDump = mockWiki.importDump as jest.Mock

function buildDump(entityId: string) {
  return {
    generatedAt: 1783094400000,
    entities: {
      [entityId]: {
        facts: [{ id: 'fact_1' }],
        tasks: [{ id: 'task_1' }],
        events: [{ id: 'evt_1' }],
        edges: [{ id: 'edge_1' }],
      },
    },
  } as any
}

describe('useImportCharacterOKF', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockDedupeEventsAgainstExisting.mockImplementation(async (_wiki, _id, dump) => dump)
    mockRemapOkfDumpIds.mockImplementation((dump) => dump)
  })

  it('previews counts from the parsed dump after picking a bundle', async () => {
    mockPickAndReadOkfBundle.mockResolvedValue([{ path: 'index.md', content: '# root' }])
    mockParseOkfBundle.mockReturnValue(buildDump('char_1'))

    const { result } = renderHook(() => useImportCharacterOKF())

    await act(async () => {
      await result.current.handlePickAndPreview('char_1')
    })

    expect(result.current.preview).toEqual({ facts: 1, tasks: 1, events: 1, edges: 1 })
  })

  it('silently swallows a cancelled picker without setting an error', async () => {
    mockPickAndReadOkfBundle.mockRejectedValue(new okfImport.OkfPickCancelledError())

    const { result } = renderHook(() => useImportCharacterOKF())

    await act(async () => {
      await result.current.handlePickAndPreview('char_1')
    })

    expect(result.current.error).toBeNull()
    expect(result.current.preview).toBeNull()
  })

  it('merge flow re-parses with the real target id, runs dedup, then imports with merge: true', async () => {
    mockPickAndReadOkfBundle.mockResolvedValue([{ path: 'index.md', content: '# root' }])
    mockParseOkfBundle.mockReturnValue(buildDump('char_1'))
    mockImportDump.mockResolvedValue(undefined)

    const { result } = renderHook(() => useImportCharacterOKF())

    await act(async () => {
      await result.current.handlePickAndPreview('char_1')
    })

    let succeeded = false
    await act(async () => {
      succeeded = await result.current.handleCommitImport('char_1', 'merge')
    })

    expect(succeeded).toBe(true)
    expect(mockDedupeEventsAgainstExisting).toHaveBeenCalledWith(expect.any(Object), 'char_1', expect.anything())
    expect(mockRemapOkfDumpIds).not.toHaveBeenCalled()
    expect(mockImportDump).toHaveBeenCalledWith(expect.anything(), { merge: true })
    expect(result.current.didImport).toBe(true)
  })

  it('replace flow runs dedup then imports with merge: false', async () => {
    mockPickAndReadOkfBundle.mockResolvedValue([{ path: 'index.md', content: '# root' }])
    mockParseOkfBundle.mockReturnValue(buildDump('char_1'))
    mockImportDump.mockResolvedValue(undefined)

    const { result } = renderHook(() => useImportCharacterOKF())

    await act(async () => {
      await result.current.handlePickAndPreview('char_1')
    })
    await act(async () => {
      await result.current.handleCommitImport('char_1', 'replace')
    })

    expect(mockDedupeEventsAgainstExisting).toHaveBeenCalled()
    expect(mockImportDump).toHaveBeenCalledWith(expect.anything(), { merge: false })
  })

  it('clone flow re-parses with the new character id, runs remap (not dedup), then imports with merge: true', async () => {
    mockPickAndReadOkfBundle.mockResolvedValue([{ path: 'index.md', content: '# root' }])
    mockParseOkfBundle.mockReturnValue(buildDump('placeholder'))

    const { result } = renderHook(() => useImportCharacterOKF())

    await act(async () => {
      await result.current.handlePickAndPreview('placeholder')
    })

    mockParseOkfBundle.mockReturnValue(buildDump('char_new'))
    mockImportDump.mockResolvedValue(undefined)

    let succeeded = false
    await act(async () => {
      succeeded = await result.current.handleCommitImport('char_new', 'clone')
    })

    expect(succeeded).toBe(true)
    expect(mockParseOkfBundle).toHaveBeenLastCalledWith('char_new', expect.anything())
    expect(mockRemapOkfDumpIds).toHaveBeenCalledWith(expect.anything(), 'char_new')
    expect(mockDedupeEventsAgainstExisting).not.toHaveBeenCalled()
    expect(mockImportDump).toHaveBeenCalledWith(expect.anything(), { merge: true })
  })

  it('surfaces a distinct retry message for WikiBusyError, returns false, without losing the original error', async () => {
    mockPickAndReadOkfBundle.mockResolvedValue([{ path: 'index.md', content: '# root' }])
    mockParseOkfBundle.mockReturnValue(buildDump('char_1'))
    mockImportDump.mockRejectedValue(new WikiBusyError('heal', 'char_1'))

    const { result } = renderHook(() => useImportCharacterOKF())

    await act(async () => {
      await result.current.handlePickAndPreview('char_1')
    })

    let succeeded = true
    await act(async () => {
      succeeded = await result.current.handleCommitImport('char_1', 'merge')
    })

    expect(succeeded).toBe(false)
    expect(result.current.error?.message).toContain('Wiki busy')
    expect((result.current.error as Error & { displayMessage?: string })?.displayMessage).toBe(
      'Memory is busy right now — try again in a moment.',
    )
  })

  it('clears filesRef/preview on successful commit so a stale second commit is a no-op', async () => {
    mockPickAndReadOkfBundle.mockResolvedValue([{ path: 'index.md', content: '# root' }])
    mockParseOkfBundle.mockReturnValue(buildDump('char_1'))
    mockImportDump.mockResolvedValue(undefined)

    const { result } = renderHook(() => useImportCharacterOKF())

    await act(async () => {
      await result.current.handlePickAndPreview('char_1')
    })
    await act(async () => {
      await result.current.handleCommitImport('char_1', 'merge')
    })

    let secondSucceeded = true
    await act(async () => {
      secondSucceeded = await result.current.handleCommitImport('char_1', 'merge')
    })

    expect(secondSucceeded).toBe(false)
    expect(mockImportDump).toHaveBeenCalledTimes(1)
  })

  it('handleCancel clears preview, filesRef, and error so a later commit is a no-op', async () => {
    mockPickAndReadOkfBundle.mockResolvedValue([{ path: 'index.md', content: '# root' }])
    mockParseOkfBundle.mockReturnValue(buildDump('char_1'))

    const { result } = renderHook(() => useImportCharacterOKF())

    await act(async () => {
      await result.current.handlePickAndPreview('char_1')
    })
    act(() => {
      result.current.handleCancel()
    })

    expect(result.current.preview).toBeNull()
    expect(result.current.error).toBeNull()

    mockImportDump.mockResolvedValue(undefined)
    let succeeded = true
    await act(async () => {
      succeeded = await result.current.handleCommitImport('char_1', 'merge')
    })
    expect(succeeded).toBe(false)
    expect(mockImportDump).not.toHaveBeenCalled()
  })
})
