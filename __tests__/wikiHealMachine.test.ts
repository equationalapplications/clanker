const mockTriggerMemoryWrite = jest.fn()
const mockTriggerMemoryHeal = jest.fn()
const mockGetMessageCount = jest.fn()
const mockGetCharacter = jest.fn()
const mockUpdateCharacter = jest.fn()
const mockIsOnline = jest.fn()

jest.mock('~/services/memoryService', () => ({
  triggerMemoryWrite: (...args: unknown[]) => mockTriggerMemoryWrite(...args),
  triggerMemoryHeal: (...args: unknown[]) => mockTriggerMemoryHeal(...args),
}))

jest.mock('~/database/messageDatabase', () => ({
  getMessageCount: (...args: unknown[]) => mockGetMessageCount(...args),
}))

jest.mock('~/database/characterDatabase', () => ({
  getCharacter: (...args: unknown[]) => mockGetCharacter(...args),
  updateCharacter: (...args: unknown[]) => mockUpdateCharacter(...args),
}))

jest.mock('@tanstack/react-query', () => ({
  onlineManager: {
    isOnline: (...args: unknown[]) => mockIsOnline(...args),
  },
}))

import { dispatchWikiWrite } from '~/machines/wikiHealMachine'

describe('dispatchWikiWrite', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockUpdateCharacter.mockResolvedValue({})
    mockTriggerMemoryWrite.mockResolvedValue(undefined)
    mockTriggerMemoryHeal.mockResolvedValue(undefined)
    mockIsOnline.mockReturnValue(true)
  })

  it('does nothing when write threshold is not reached', async () => {
    mockGetMessageCount.mockResolvedValue(12)
    mockGetCharacter.mockResolvedValue({
      memory_checkpoint: 0,
      heal_checkpoint: 0,
    })

    await dispatchWikiWrite({
      character: {
        id: 'char-1',
        name: 'Nova',
        appearance: '',
        traits: '',
        emotions: '',
        context: '',
      },
      userId: 'user-1',
      chunk: 'Small update',
    })

    expect(mockUpdateCharacter).not.toHaveBeenCalled()
    expect(mockTriggerMemoryWrite).not.toHaveBeenCalled()
    expect(mockTriggerMemoryHeal).not.toHaveBeenCalled()
  })

  it('does not consume checkpoint while offline', async () => {
    mockGetMessageCount.mockResolvedValue(25)
    mockGetCharacter.mockResolvedValue({
      memory_checkpoint: 0,
      heal_checkpoint: 0,
    })
    mockIsOnline.mockReturnValue(false)

    await dispatchWikiWrite({
      character: {
        id: 'char-1',
        name: 'Nova',
        appearance: '',
        traits: '',
        emotions: '',
        context: '',
      },
      userId: 'user-1',
      chunk: 'Need follow up next chat',
    })

    expect(mockUpdateCharacter).not.toHaveBeenCalled()
    expect(mockTriggerMemoryWrite).not.toHaveBeenCalled()
  })

  it('advances checkpoints and triggers write and heal when both thresholds met', async () => {
    mockGetMessageCount.mockResolvedValue(40)
    mockGetCharacter.mockResolvedValue({
      memory_checkpoint: 10,
      heal_checkpoint: 10,
    })

    await dispatchWikiWrite({
      character: {
        id: 'char-1',
        name: 'Nova',
        appearance: '',
        traits: '',
        emotions: '',
        context: '',
      },
      userId: 'user-1',
      chunk: 'Ask about training plan next session',
    })

    expect(mockUpdateCharacter).toHaveBeenNthCalledWith(1, 'char-1', 'user-1', {
      memory_checkpoint: 40,
    })
    expect(mockTriggerMemoryWrite).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'char-1' }),
      'user-1',
      'Ask about training plan next session',
    )
    expect(mockUpdateCharacter).toHaveBeenNthCalledWith(2, 'char-1', 'user-1', {
      heal_checkpoint: 40,
    })
    expect(mockTriggerMemoryHeal).toHaveBeenCalledWith('char-1', undefined)
  })
})
