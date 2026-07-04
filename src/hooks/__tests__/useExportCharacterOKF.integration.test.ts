import { renderHook, act, waitFor } from '@testing-library/react-native'
import { useExportCharacterOKF } from '../useExportCharacterOKF'
import * as okfSave from '~/utilities/okfSave'

jest.mock('@equationalapplications/expo-llm-wiki', () => {
  const wiki = {
    exportDump: jest.fn().mockResolvedValue({
      generatedAt: 1783094400000,
      entities: {
        char_123: {
          facts: [
            { id: 'fact_abc', entity_id: 'char_123', content: 'Fact A' },
            { id: 'fact_xyz', entity_id: 'char_123', content: 'Fact B' },
          ],
          tasks: [],
          events: [],
          edges: [
            {
              id: 'edge_1',
              entity_id: 'char_123',
              source_id: 'fact_abc',
              target_id: 'fact_xyz',
              edge_type: 'related_to',
              created_at: 1234567890,
            },
          ],
        },
      },
    }),
  }

  return {
    useWiki: () => wiki,
    formatOkfBundle: jest.fn().mockReturnValue({
      files: [
        {
          path: 'index.md',
          content: '# Root Index\n\nEntities: char_123',
        },
        {
          path: 'entities/char_123/facts/fact_abc.md',
          content: `---
type: fact
id: fact_abc
title: "Fact A"
---
Body A`,
        },
        {
          path: 'entities/char_123/facts/fact_xyz.md',
          content: `---
type: fact
id: fact_xyz
title: "Fact B"
---
Body B`,
        },
      ],
    }),
  }
})

jest.mock('~/utilities/okfSave')
jest.mock('~/utilities/reportError', () => ({
  reportError: jest.fn(),
}))

describe('useExportCharacterOKF', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(okfSave.zipAndSaveOKF as jest.Mock).mockResolvedValue({ saveLocation: 'share' })
  })

  it('exports character memory and saves ZIP', async () => {
    const { result } = renderHook(() =>
      useExportCharacterOKF('char_123', 'TestChar'),
    )

    expect(result.current.isExporting).toBe(false)
    expect(result.current.error).toBeNull()

    await act(async () => {
      await result.current.exportOkf()
    })

    await waitFor(() => {
      expect(result.current.isExporting).toBe(false)
    })

    expect(okfSave.zipAndSaveOKF).toHaveBeenCalledWith(
      expect.objectContaining({
        characterName: 'TestChar',
        files: expect.arrayContaining([
          expect.objectContaining({
            path: 'index.md',
          }),
          expect.objectContaining({
            path: 'README.md',
          }),
        ]),
      }),
    )
    expect(result.current.lastResult).toEqual({ isEmpty: false, saveLocation: 'share' })
  })

  it('augments files with edge links before zipping', async () => {
    const { result } = renderHook(() =>
      useExportCharacterOKF('char_123', 'TestChar'),
    )

    await act(async () => {
      await result.current.exportOkf()
    })

    const callArgs = (okfSave.zipAndSaveOKF as jest.Mock).mock.calls[0][0]
    const factFile = callArgs.files.find((file: { path: string }) =>
      file.path.includes('fact_abc.md'),
    )

    expect(factFile.content).toContain('## Related')
    expect(factFile.content).toContain('[related_to](./fact_xyz.md)')
  })

  it('keeps export callback stable while using the latest character name', async () => {
    const { result, rerender } = renderHook<
      ReturnType<typeof useExportCharacterOKF>,
      { characterName: string }
    >(
      ({ characterName }) => useExportCharacterOKF('char_123', characterName),
      { initialProps: { characterName: 'OriginalName' } },
    )
    const firstExportOkf = result.current.exportOkf

    rerender({ characterName: 'RenamedCharacter' })

    expect(result.current.exportOkf).toBe(firstExportOkf)

    await act(async () => {
      await result.current.exportOkf()
    })

    expect(okfSave.zipAndSaveOKF).toHaveBeenCalledWith(
      expect.objectContaining({
        characterName: 'RenamedCharacter',
      }),
    )
  })

  it('handles export errors and sets error state', async () => {
    const { result } = renderHook(() =>
      useExportCharacterOKF('char_123', 'TestChar'),
    )

    ;(okfSave.zipAndSaveOKF as jest.Mock).mockRejectedValueOnce(
      new Error('ZIP generation failed'),
    )

    await act(async () => {
      await result.current.exportOkf()
    })

    await waitFor(() => {
      expect(result.current.isExporting).toBe(false)
    })

    expect(result.current.error).not.toBeNull()
    expect(result.current.error?.message).toContain('ZIP generation failed')
    expect(result.current.lastResult).toBeNull()
  })

  it('keeps isExporting true until zipAndSaveOKF resolves', async () => {
    let resolveZip!: () => void
    const zipStarted = new Promise<void>((resolveStarted) => {
      ;(okfSave.zipAndSaveOKF as jest.Mock).mockImplementationOnce(
        () =>
          new Promise<{ saveLocation: 'share' }>((resolve) => {
            resolveZip = () => resolve({ saveLocation: 'share' })
            resolveStarted()
          }),
      )
    })
    const { result } = renderHook(() =>
      useExportCharacterOKF('char_123', 'TestChar'),
    )

    let exportPromise!: Promise<void>
    await act(async () => {
      exportPromise = result.current.exportOkf()
      await zipStarted
    })

    await waitFor(() => {
      expect(result.current.isExporting).toBe(true)
    })

    await act(async () => {
      resolveZip()
      await exportPromise
    })

    expect(result.current.isExporting).toBe(false)
  })

  it('ignores concurrent export calls while one is in flight', async () => {
    let resolveZip!: () => void
    const zipStarted = new Promise<void>((resolveStarted) => {
      ;(okfSave.zipAndSaveOKF as jest.Mock).mockImplementationOnce(
        () =>
          new Promise<{ saveLocation: 'share' }>((resolve) => {
            resolveZip = () => resolve({ saveLocation: 'share' })
            resolveStarted()
          }),
      )
    })
    const { result } = renderHook(() =>
      useExportCharacterOKF('char_123', 'TestChar'),
    )

    await act(async () => {
      const firstExport = result.current.exportOkf()
      const secondExport = result.current.exportOkf()
      await zipStarted
      resolveZip()
      await Promise.all([firstExport, secondExport])
    })

    expect(okfSave.zipAndSaveOKF).toHaveBeenCalledTimes(1)
    expect(result.current.lastResult).toEqual({ isEmpty: false, saveLocation: 'share' })
  })
})
