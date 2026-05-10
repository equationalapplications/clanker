/**
 * Alert: `jest.mock('react-native', () => ({ ...requireActual('react-native'), Alert }))` trips
 * TurboModuleRegistry (DevMenu) when @testing-library/react-native loads. Auto-confirm delete
 * via `jest.spyOn(Alert, 'alert')` in beforeEach instead.
 */
jest.mock('@equationalapplications/expo-llm-wiki', () => ({
  ...jest.requireActual('@equationalapplications/expo-llm-wiki'),
  useWiki: jest.fn().mockReturnValue(null),
}))
jest.mock('~/hooks/useMemoryBundle', () => ({
  useMemoryBundle: jest.fn(),
}))
jest.mock('~/utilities/reportError', () => ({ reportError: jest.fn() }))
jest.mock('~/hooks/useCharacterWiki', () => ({
  useCharacterWiki: jest.fn().mockReturnValue({
    forget: jest.fn().mockResolvedValue(undefined),
    status: { ingesting: false, librarian: false, heal: false },
    isBusy: false,
    isIngesting: false,
    error: null,
    read: jest.fn(),
    write: jest.fn(),
    ingest: jest.fn(),
    sync: jest.fn(),
    hasChanged: jest.fn(),
  }),
}))
jest.mock('expo-router', () => ({
  useLocalSearchParams: jest.fn().mockReturnValue({ id: 'char1' }),
  router: { back: jest.fn(), canGoBack: jest.fn(() => true), replace: jest.fn() },
}))

import React from 'react'
import { Alert } from 'react-native'
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native'
import { PaperProvider } from 'react-native-paper'
import MemoryInspectorScreen from '../app/(drawer)/(tabs)/characters/[id]/memory'
import { useMemoryBundle } from '~/hooks/useMemoryBundle'
import { useCharacterWiki } from '~/hooks/useCharacterWiki'
import { reportError } from '~/utilities/reportError'

const BUNDLE = {
  facts: [
    {
      id: 'f1',
      entity_id: 'char1',
      title: 'Likes cats',
      body: 'User said they like cats',
      tags: ['pets'],
      confidence: 'certain' as const,
      source_type: 'user_stated' as const,
      source_hash: null,
      source_ref: null,
      created_at: 1000,
      updated_at: 1000,
      last_accessed_at: null,
      access_count: 0,
      deleted_at: null,
    },
  ],
  tasks: [
    {
      id: 't1',
      entity_id: 'char1',
      description: 'Buy cat food',
      status: 'pending' as const,
      priority: 1,
      created_at: 1000,
      updated_at: 1000,
      resolved_at: null,
      deleted_at: null,
    },
  ],
  events: [
    {
      id: 'e1',
      entity_id: 'char1',
      event_type: 'observation' as const,
      summary: 'Mentioned cats',
      created_at: 1000,
    },
  ],
}

const wrapper = ({ children }: { children: React.ReactNode }) => <PaperProvider>{children}</PaperProvider>

describe('MemoryInspectorScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      const destructive = buttons?.find((b) => b.style === 'destructive')
      void destructive?.onPress?.()
    })
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  test('renders facts, tasks, and events sections', () => {
    jest.mocked(useMemoryBundle).mockReturnValue({
      bundle: BUNDLE,
      isLoading: false,
      error: null,
      refetch: jest.fn(),
    })

    render(<MemoryInspectorScreen />, { wrapper })

    expect(screen.getByText('Likes cats')).toBeTruthy()
    expect(screen.getByText('Buy cat food')).toBeTruthy()
    expect(screen.getByText('Mentioned cats')).toBeTruthy()
  })

  test('shows loading indicator when loading', () => {
    jest.mocked(useMemoryBundle).mockReturnValue({
      bundle: null,
      isLoading: true,
      error: null,
      refetch: jest.fn(),
    })

    render(<MemoryInspectorScreen />, { wrapper })

    expect(screen.getByText(/loading/i)).toBeTruthy()
  })

  test('calls forget with entryId when deleting a fact', async () => {
    const forgetMock = jest.fn().mockResolvedValue(undefined)
    const refetchMock = jest.fn()
    jest.mocked(useCharacterWiki).mockReturnValue({
      forget: forgetMock,
      status: { ingesting: false, librarian: false, heal: false },
      isBusy: false,
      isIngesting: false,
      error: null,
      read: jest.fn(),
      write: jest.fn(),
      ingest: jest.fn(),
      sync: jest.fn(),
      hasChanged: jest.fn(),
    } as never)
    jest.mocked(useMemoryBundle).mockReturnValue({
      bundle: BUNDLE,
      isLoading: false,
      error: null,
      refetch: refetchMock,
    })

    render(<MemoryInspectorScreen />, { wrapper })

    const deleteButtons = screen.getAllByLabelText('Delete')
    fireEvent.press(deleteButtons[0])

    await waitFor(() => {
      expect(forgetMock).toHaveBeenCalledWith({ entryId: 'f1' })
      expect(refetchMock).toHaveBeenCalled()
    })
  })

  test('calls forget with taskId when deleting a task', async () => {
    const forgetMock = jest.fn().mockResolvedValue(undefined)
    const refetchMock = jest.fn()
    jest.mocked(useCharacterWiki).mockReturnValue({
      forget: forgetMock,
      status: { ingesting: false, librarian: false, heal: false },
      isBusy: false,
      isIngesting: false,
      error: null,
      read: jest.fn(),
      write: jest.fn(),
      ingest: jest.fn(),
      sync: jest.fn(),
      hasChanged: jest.fn(),
    } as never)
    jest.mocked(useMemoryBundle).mockReturnValue({
      bundle: BUNDLE,
      isLoading: false,
      error: null,
      refetch: refetchMock,
    })

    render(<MemoryInspectorScreen />, { wrapper })

    const deleteButtons = screen.getAllByLabelText('Delete')
    fireEvent.press(deleteButtons[1])

    await waitFor(() => {
      expect(forgetMock).toHaveBeenCalledWith({ taskId: 't1' })
      expect(refetchMock).toHaveBeenCalled()
    })
  })

  test('reports error and skips refetch when forget rejects on fact delete', async () => {
    const forgetMock = jest.fn().mockRejectedValue(new Error('Wiki forgetting timed out'))
    const refetchMock = jest.fn()
    jest.mocked(useCharacterWiki).mockReturnValue({
      forget: forgetMock,
      status: { ingesting: false, librarian: false, heal: false },
      isBusy: false,
      isIngesting: false,
      error: null,
      read: jest.fn(),
      write: jest.fn(),
      ingest: jest.fn(),
      sync: jest.fn(),
      hasChanged: jest.fn(),
    } as never)
    jest.mocked(useMemoryBundle).mockReturnValue({
      bundle: BUNDLE,
      isLoading: false,
      error: null,
      refetch: refetchMock,
    })

    render(<MemoryInspectorScreen />, { wrapper })

    const deleteButtons = screen.getAllByLabelText('Delete')
    fireEvent.press(deleteButtons[0])

    await waitFor(() => {
      expect(reportError).toHaveBeenCalledWith(
        expect.any(Error),
        'wiki:char1:memory-forget-fact',
      )
      expect(Alert.alert).toHaveBeenCalledWith('Delete failed', 'Wiki forgetting timed out')
    })
    expect(refetchMock).not.toHaveBeenCalled()
  })
})
