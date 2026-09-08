import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react-native'
import { useProactiveUnread } from '../useProactiveUnread'
import { countUnreadProactive } from '~/database/messageDatabase'

const mockCountUnreadProactive = jest.fn()
jest.mock('~/database/messageDatabase', () => ({
  countUnreadProactive: (...args: unknown[]) => mockCountUnreadProactive(...args),
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
  const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  return { queryClient, Wrapper }
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('useProactiveUnread', () => {
  it('reports a dot, not a count', async () => {
    mockCountUnreadProactive.mockResolvedValue(7)
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useProactiveUnread('char-1'), { wrapper: Wrapper })
    await waitFor(() => expect(result.current.hasUnread).toBe(true))
    // Deliberately boolean: AI chats are not an inbox, and a numeric count
    // reads as a backlog to clear.
    expect(result.current).not.toHaveProperty('count')
  })

  it('drops the dot once everything is read', async () => {
    mockCountUnreadProactive.mockResolvedValue(0)
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useProactiveUnread('char-1'), { wrapper: Wrapper })
    await waitFor(() => expect(result.current.hasUnread).toBe(false))
  })
})
