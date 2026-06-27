import { renderHook } from '@testing-library/react-native'
import { useSelector } from '@xstate/react'
import { setActiveCharacterId } from '~/hooks/useActiveCharacterId'
import { useTabCharacterId } from '~/hooks/useTabCharacterId'

jest.mock('@xstate/react', () => ({
  useSelector: jest.fn(),
}))

jest.mock('~/hooks/useMachines', () => ({
  useCharacterMachine: jest.fn(() => ({})),
  useAuthMachine: jest.fn(() => ({})),
}))

const mockUseMostRecentMessage = jest.fn(() => ({ data: undefined as { character_id: string } | undefined, isLoading: false }))
jest.mock('~/hooks/useMessages', () => ({
  useMostRecentMessage: () => mockUseMostRecentMessage(),
}))

const mockUseCharacters = jest.fn()
jest.mock('~/hooks/useCharacters', () => ({
  useCharacters: () => mockUseCharacters(),
}))

const mockUseSelector = useSelector as jest.Mock

const mockMachineState = {
  context: { dbUser: { defaultCharacterId: 'default-char' } },
  matches: (state: string) => state === 'creatingDefault',
}

describe('useTabCharacterId', () => {
  beforeEach(() => {
    setActiveCharacterId(null)
    mockUseMostRecentMessage.mockReturnValue({ data: undefined, isLoading: false })
    mockUseSelector.mockImplementation((_service: unknown, selector: (s: typeof mockMachineState) => unknown) =>
      selector(mockMachineState),
    )
    mockUseCharacters.mockReturnValue({
      characters: [{ id: 'char-a' }, { id: 'char-b' }],
      isLoading: false,
    })
  })

  afterEach(() => {
    setActiveCharacterId(null)
    jest.clearAllMocks()
  })

  it('uses activeCharacterId when it exists in the characters list', () => {
    setActiveCharacterId('char-b')

    const { result } = renderHook(() => useTabCharacterId())

    expect(result.current.characterId).toBe('char-b')
  })

  it('falls back when activeCharacterId is not in the characters list', () => {
    setActiveCharacterId('deleted-char')

    const { result } = renderHook(() => useTabCharacterId())

    expect(result.current.characterId).toBe('char-a')
  })

  it('skips stale mostRecentMessage character_id', () => {
    mockUseMostRecentMessage.mockReturnValue({
      data: { character_id: 'deleted-char' },
      isLoading: false,
    })

    const { result } = renderHook(() => useTabCharacterId())

    expect(result.current.characterId).toBe('char-a')
  })

  it('skips stale defaultCharacterId', () => {
    mockUseSelector.mockImplementation((_service: unknown, selector: (s: typeof mockMachineState) => unknown) =>
      selector({ ...mockMachineState, context: { dbUser: { defaultCharacterId: 'deleted-char' } } }),
    )

    const { result } = renderHook(() => useTabCharacterId())

    expect(result.current.characterId).toBe('char-a')
  })
})
