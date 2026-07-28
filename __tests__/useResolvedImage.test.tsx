import React from 'react'
import { act, create } from 'react-test-renderer'
import { useResolvedImage } from '~/hooks/useResolvedImage'

const mockGetById = jest.fn()
const mockResolve = jest.fn()

jest.mock('~/database/characterImageDatabase', () => ({
  getCharacterImageById: (...a: unknown[]) => mockGetById(...a),
}))
jest.mock('~/services/localImageStore', () => ({
  resolveImageUri: (...a: unknown[]) => mockResolve(...a),
}))

function Probe({ imageId, variant }: { imageId: string | null; variant: 'master' | 'thumb' }) {
  const uri = useResolvedImage(imageId, variant)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return React.createElement('probe' as any, { uri })
}

async function render(imageId: string | null, variant: 'master' | 'thumb' = 'master') {
  let tree: any
  await act(async () => { tree = create(<Probe imageId={imageId} variant={variant} />) })
  await act(async () => { await Promise.resolve() })
  return tree
}

beforeEach(() => {
  jest.clearAllMocks()
  mockGetById.mockResolvedValue({ id: 'img-1', storage_kind: 'inline', master_ref: 'M', mime_type: 'image/webp' })
  mockResolve.mockResolvedValue('data:image/webp;base64,M')
})

describe('useResolvedImage', () => {
  it('returns null while nothing is requested', async () => {
    const tree = await render(null)
    expect(tree.root.findByType('probe').props.uri).toBeNull()
    expect(mockGetById).not.toHaveBeenCalled()
  })

  it('resolves the row for the requested variant', async () => {
    const tree = await render('img-1', 'thumb')
    expect(mockResolve).toHaveBeenCalledWith(expect.objectContaining({ id: 'img-1' }), 'thumb')
    expect(tree.root.findByType('probe').props.uri).toBe('data:image/webp;base64,M')
  })

  it('yields null when the row is gone', async () => {
    mockGetById.mockResolvedValue(null)
    const tree = await render('missing')
    expect(tree.root.findByType('probe').props.uri).toBeNull()
  })

  it('yields null instead of throwing when resolution fails', async () => {
    mockResolve.mockRejectedValue(new Error('offline'))
    const tree = await render('img-1')
    expect(tree.root.findByType('probe').props.uri).toBeNull()
  })
})
