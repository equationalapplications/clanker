import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildCharacterUpdateValues,
  CharacterOwnershipError,
  createCharacterService,
} from './characterService.js'
import { characters } from '../db/schema.js'

test('buildCharacterUpdateValues omits isPublic when field is undefined', () => {
  const result = buildCharacterUpdateValues({
    name: 'Updated',
    appearance: null,
    traits: null,
    emotions: null,
    context: null,
    isPublic: undefined,
    updatedAt: undefined,
  })

  assert.equal('isPublic' in result, false)
})

test('buildCharacterUpdateValues includes isPublic when field is provided', () => {
  const result = buildCharacterUpdateValues({
    name: 'Updated',
    appearance: null,
    traits: null,
    emotions: null,
    context: null,
    isPublic: true,
    updatedAt: undefined,
  })

  assert.equal('isPublic' in result, true)
  assert.equal((result as { isPublic?: boolean }).isPublic, true)
})

test('buildCharacterUpdateValues omits undefined voice', () => {
  const result = buildCharacterUpdateValues({
    name: 'Updated',
    appearance: null,
    traits: null,
    emotions: null,
    context: null,
    voice: undefined,
    isPublic: undefined,
    updatedAt: undefined,
  })

  assert.equal('voice' in result, false)
})

test('upsertCharacter rejects writing over a character owned by another user', async () => {
  let conflictTarget: unknown
  let conflictWhere: unknown

  const fakeDb = {
    insert: () => ({
      values: () => ({
        onConflictDoUpdate: (params: { target: unknown; where: unknown }) => {
          conflictTarget = params.target
          conflictWhere = params.where

          return {
            returning: async () => [],
          }
        },
        returning: async () => [{ id: 'new-char', userId: 'user-1' }],
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [{ id: 'char-1', userId: 'other-user' }],
        }),
      }),
    }),
  }

  const service = createCharacterService({
    getDb: async () => fakeDb as never,
  })

  await assert.rejects(async () => {
    await service.upsertCharacter({ id: 'char-1', name: 'Updated Name' } as never, 'user-1')
  }, CharacterOwnershipError)

  assert.equal(conflictTarget, characters.id)
  assert.ok(conflictWhere)
})

test('assertCharacterOwnership rejects a character owned by another user', async () => {
  const fakeDb = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [{ id: 'char-1', userId: 'other-user' }],
        }),
      }),
    }),
  }

  const service = createCharacterService({ getDb: async () => fakeDb as never })

  await assert.rejects(
    async () => service.assertCharacterOwnership('char-1', 'user-1'),
    CharacterOwnershipError,
  )
})

test('assertCharacterOwnership resolves for the owning user', async () => {
  const fakeDb = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [{ id: 'char-1', userId: 'user-1' }],
        }),
      }),
    }),
  }

  const service = createCharacterService({ getDb: async () => fakeDb as never })

  await assert.doesNotReject(async () => service.assertCharacterOwnership('char-1', 'user-1'))
})

test('assertCharacterOwnership does not throw when the character does not exist', async () => {
  const fakeDb = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [],
        }),
      }),
    }),
  }

  const service = createCharacterService({ getDb: async () => fakeDb as never })

  await assert.doesNotReject(async () => service.assertCharacterOwnership('missing', 'user-1'))
})

test('buildCharacterUpdateValues never writes the dropped avatar column', () => {
  const result = buildCharacterUpdateValues({
    name: 'Updated',
    appearance: null,
    traits: null,
    emotions: null,
    context: null,
    voice: 'narrator',
    isPublic: true,
    updatedAt: undefined,
  })

  assert.equal('avatar' in result, false)
})
