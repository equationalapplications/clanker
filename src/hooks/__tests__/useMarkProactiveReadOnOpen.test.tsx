import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react-native'
import { useMarkProactiveReadOnOpen } from '../useMarkProactiveReadOnOpen'

const mockCount = jest.fn()
const mockMarkLocally = jest.fn()
const mockEnqueue = jest.fn()
jest.mock('~/database/messageDatabase', () => ({
  countUnreadProactive: (...a: unknown[]) => mockCount(...a),
  markProactiveReadLocally: (...a: unknown[]) => mockMarkLocally(...a),
}))
jest.mock('~/services/proactiveReadQueue', () => ({
  enqueueMarkRead: (...a: unknown[]) => mockEnqueue(...a),
}))
jest.mock('~/services/proactiveMarkReadService', () => ({
  markProactiveReadViaCallable: jest.fn(),
}))

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      // Reclaim cache immediately — nothing needs to survive the test, and
      // jest-expo's worker exits cleanly when there are no live subscribers
      // pointing at pending garbage-collection timers.
      queries: { retry: false, gcTime: 0 },
      mutations: { gcTime: 0 },
    },
  })
  const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries')
  const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  return { queryClient, invalidateSpy, Wrapper }
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('useMarkProactiveReadOnOpen', () => {
  it('marks locally, invalidates the unread cache, and enqueues ids when unread > 0', async () => {
    mockCount.mockResolvedValue(2)
    mockMarkLocally.mockResolvedValue(['p1', 'p2'])
    const { invalidateSpy, Wrapper } = createWrapper()
    renderHook(() => useMarkProactiveReadOnOpen('c1'), { wrapper: Wrapper })
    await waitFor(() => expect(mockEnqueue).toHaveBeenCalledWith(['p1', 'p2'], expect.any(Function)))
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['proactiveUnread'] })
  })

  it('does nothing when unread is 0 (second open is a no-op)', async () => {
    mockCount.mockResolvedValue(0)
    const { Wrapper } = createWrapper()
    renderHook(() => useMarkProactiveReadOnOpen('c1'), { wrapper: Wrapper })
    await waitFor(() => expect(mockCount).toHaveBeenCalled())
    expect(mockMarkLocally).not.toHaveBeenCalled()
    expect(mockEnqueue).not.toHaveBeenCalled()
  })

  it('does not enqueue when the local write returned no ids', async () => {
    mockCount.mockResolvedValue(2)
    mockMarkLocally.mockResolvedValue([])
    const { Wrapper } = createWrapper()
    renderHook(() => useMarkProactiveReadOnOpen('c1'), { wrapper: Wrapper })
    await waitFor(() => expect(mockMarkLocally).toHaveBeenCalled())
    expect(mockEnqueue).not.toHaveBeenCalled()
  })
})