import { buildSystemInstruction, buildContentHistory } from '../CharacterPromptBuilder'
import type { CharacterPromptContext } from '../CharacterPromptBuilder'
import type { IMessage } from 'react-native-gifted-chat'

const baseCharacter = {
  id: 'char-1',
  name: 'Aria',
  appearance: 'A warm, curious companion',
  traits: 'Thoughtful, empathetic',
  emotions: 'Gentle and expressive',
  context: 'We met last week and talked about astronomy.',
}

describe('buildSystemInstruction', () => {
  it('includes character name', () => {
    const ctx: CharacterPromptContext = { character: baseCharacter, userId: 'u1' }
    expect(buildSystemInstruction(ctx)).toContain('Aria')
  })

  it('includes appearance, traits, emotions, context', () => {
    const ctx: CharacterPromptContext = { character: baseCharacter, userId: 'u1' }
    const result = buildSystemInstruction(ctx)
    expect(result).toContain('A warm, curious companion')
    expect(result).toContain('Thoughtful, empathetic')
    expect(result).toContain('Gentle and expressive')
    expect(result).toContain('We met last week')
  })

  it('includes memoryBlock when provided', () => {
    const ctx: CharacterPromptContext = {
      character: baseCharacter,
      userId: 'u1',
      memoryBlock: 'User likes jazz music.',
    }
    expect(buildSystemInstruction(ctx)).toContain('User likes jazz music.')
  })

  it('omits memory section when memoryBlock is undefined', () => {
    const ctx: CharacterPromptContext = { character: baseCharacter, userId: 'u1' }
    expect(buildSystemInstruction(ctx)).not.toContain('Memory')
  })

  it('includes stay-in-character instruction', () => {
    const ctx: CharacterPromptContext = { character: baseCharacter, userId: 'u1' }
    expect(buildSystemInstruction(ctx)).toContain('Stay in character')
  })

  it('omits context section when character.context is empty', () => {
    const ctx: CharacterPromptContext = {
      character: { ...baseCharacter, context: '' },
      userId: 'u1',
    }
    expect(buildSystemInstruction(ctx)).not.toContain('Conversation context')
  })

  it('includes fourth-wall directive to never reveal AI identity', () => {
    const ctx: CharacterPromptContext = { character: baseCharacter, userId: 'u1' }
    expect(buildSystemInstruction(ctx)).toContain('Never reveal you are an AI')
  })
})

describe('buildContentHistory', () => {
  const userId = 'user-123'
  const charId = 'char-1'

  const makeMsg = (
    id: string,
    text: string,
    senderId: string,
    createdAt: Date,
  ): IMessage => ({
    _id: id,
    text,
    createdAt,
    user: { _id: senderId },
  })

  it('maps user message to role "user"', () => {
    const msgs = [makeMsg('1', 'Hello', userId, new Date(1000))]
    const result = buildContentHistory(msgs, userId)
    expect(result).toHaveLength(1)
    expect(result[0].role).toBe('user')
    expect(result[0].parts[0].text).toBe('Hello')
  })

  it('maps AI message to role "model"', () => {
    const msgs = [makeMsg('2', 'Hi there!', charId, new Date(2000))]
    const result = buildContentHistory(msgs, userId)
    expect(result).toHaveLength(1)
    expect(result[0].role).toBe('model')
  })

  it('sorts oldest to newest', () => {
    const msgs = [
      makeMsg('b', 'Second', charId, new Date(2000)),
      makeMsg('a', 'First', userId, new Date(1000)),
    ]
    const result = buildContentHistory(msgs, userId)
    expect(result[0].parts[0].text).toBe('First')
    expect(result[1].parts[0].text).toBe('Second')
  })

  it('filters out messages with empty text', () => {
    const msgs = [
      makeMsg('1', '', userId, new Date(1000)),
      makeMsg('2', 'Valid', userId, new Date(2000)),
    ]
    const result = buildContentHistory(msgs, userId)
    expect(result).toHaveLength(1)
    expect(result[0].parts[0].text).toBe('Valid')
  })

  it('filters out whitespace-only messages', () => {
    const msgs = [
      makeMsg('1', '   ', userId, new Date(1000)),
      makeMsg('2', 'Valid', userId, new Date(2000)),
    ]
    const result = buildContentHistory(msgs, userId)
    expect(result).toHaveLength(1)
    expect(result[0].parts[0].text).toBe('Valid')
  })

  it('returns empty array for empty input', () => {
    expect(buildContentHistory([], userId)).toEqual([])
  })
})
