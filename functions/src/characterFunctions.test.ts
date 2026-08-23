import assert from 'node:assert/strict'
import test from 'node:test'
import { HttpsError } from 'firebase-functions/v2/https'

process.env.NODE_ENV = 'test'

const {
  syncCharacterHandler,
  deleteCharacterHandler,
  getUserCharactersHandler,
  getPublicCharacterHandler,
  syncCharacterImagesHandler,
} = await import('./characterFunctions.js')
const { CharacterOwnershipError } = await import('./services/characterService.js')

type CharacterFunctionDeps = NonNullable<Parameters<typeof syncCharacterHandler>[1]>

function buildDeps(): CharacterFunctionDeps {
  return {
    userRepository: {
      getOrCreateUserByFirebaseIdentity: async () => {
        throw new Error('Unexpected repository call')
      },
      findUserByEmail: async () => {
        throw new Error('Unexpected repository call')
      },
      findUserByFirebaseUid: async () => {
        throw new Error('Unexpected repository call')
      },
      updateUser: async () => {
        throw new Error('Unexpected repository call')
      },
    },
    characterService: {
      getUserCharacterCount: async () => {
        throw new Error('Unexpected character service call')
      },
      getCharacterMessageCount: async () => {
        throw new Error('Unexpected character service call')
      },
      upsertCharacter: async () => {
        throw new Error('Unexpected character service call')
      },
      deleteCharacter: async () => {
        throw new Error('Unexpected character service call')
      },
      getUserCharacters: async () => {
        throw new Error('Unexpected character service call')
      },
      getPublicCharacterById: async () => {
        throw new Error('Unexpected character service call')
      },
      assertCharacterOwnership: async () => {},
      isOwnedByUser: async () => {
        throw new Error('Unexpected character service call')
      },
    },
    characterImageService: {
      syncImages: async () => {
        throw new Error('Unexpected characterImageService call')
      },
      deleteImages: async () => {
        throw new Error('Unexpected characterImageService call')
      },
      listImages: async () => {
        throw new Error('Unexpected characterImageService call')
      },
      listImagesByCharacters: async () => {
        throw new Error('Unexpected characterImageService call')
      },
      setActiveImage: async () => {
        throw new Error('Unexpected characterImageService call')
      },
      purgeCharacter: async () => {
        throw new Error('Unexpected characterImageService call')
      },
    },
    subscriptionService: {
      getSubscription: async () => {
        throw new Error('Unexpected subscription service call')
      },
    },
    creditService: {
      spendCredits: async () => {
        throw new Error('Unexpected creditService.spendCredits call')
      },
      refundCredit: async () => {
        throw new Error('Unexpected creditService.refundCredit call')
      },
    },
  } as unknown as CharacterFunctionDeps
}

const auth = {
  uid: 'firebase-uid-1',
  token: {
    uid: 'firebase-uid-1',
    email: 'person@example.com',
  },
}

test('syncCharacterHandler rejects undefined payload', async () => {
  await assert.rejects(
    async () => syncCharacterHandler({ auth, data: undefined } as never, buildDeps()),
    (err: unknown) =>
      err instanceof HttpsError &&
      err.code === 'invalid-argument' &&
      err.message.includes('Valid character data is required'),
  )
})

test('syncCharacterHandler rejects null payload', async () => {
  await assert.rejects(
    async () => syncCharacterHandler({ auth, data: null } as never, buildDeps()),
    (err: unknown) =>
      err instanceof HttpsError &&
      err.code === 'invalid-argument' &&
      err.message.includes('Valid character data is required'),
  )
})

test('deleteCharacterHandler rejects undefined payload', async () => {
  await assert.rejects(
    async () => deleteCharacterHandler({ auth, data: undefined } as never, buildDeps()),
    (err: unknown) =>
      err instanceof HttpsError &&
      err.code === 'invalid-argument' &&
      err.message.includes('Character ID is required'),
  )
})

test('deleteCharacterHandler rejects non-string characterId', async () => {
  await assert.rejects(
    async () => deleteCharacterHandler({ auth, data: { characterId: 7 } } as never, buildDeps()),
    (err: unknown) =>
      err instanceof HttpsError &&
      err.code === 'invalid-argument' &&
      err.message.includes('Character ID is required'),
  )
})

test('syncCharacterHandler rejects invalid optional text fields', async () => {
  await assert.rejects(
    async () =>
      syncCharacterHandler(
        {
          auth,
          data: {
            character: {
              name: 'Nova',
              appearance: 42,
            },
          },
        } as never,
        buildDeps(),
      ),
    (err: unknown) =>
      err instanceof HttpsError &&
      err.code === 'invalid-argument' &&
      err.message.includes('character.appearance must be a string or null'),
  )
})

test('syncCharacterHandler silently drops the removed avatar payload field', async () => {
  const captured: unknown[] = []
  const createdAt = new Date('2026-01-01T00:00:00.000Z')
  const updatedAt = new Date('2026-01-02T00:00:00.000Z')
  const result = await syncCharacterHandler(
    {
      auth,
      data: {
        // Pre-drop clients still send `avatar`; the field must be ignored —
        // neither rejected nor stored.
        character: { name: 'Nova', avatar: 'https://example.com/legacy.png' },
      },
    } as never,
    {
      userRepository: {
        findUserByFirebaseUid: async () => ({ id: 'user-1' }) as never,
      },
      characterService: {
        upsertCharacter: async (...args: unknown[]) => {
          captured.push(args[0])
          return {
            id: 'character-1',
            userId: 'user-1',
            name: 'Nova',
            appearance: null,
            traits: null,
            emotions: null,
            context: null,
            isPublic: false,
            createdAt,
            updatedAt,
          } as never
        },
      } as never,
      creditService: {
        spendCredits: async () => [{ transactionId: 'tx-123', amount: 1 }],
        refundCredit: async () => {},
      },
    } as unknown as CharacterFunctionDeps,
  )

  assert.equal((result as Record<string, unknown>).name, 'Nova')
  assert.equal(captured.length, 1)
  assert.equal('avatar' in (captured[0] as Record<string, unknown>), false)
})

test('syncCharacterHandler rejects invalid optional boolean field', async () => {
  await assert.rejects(
    async () =>
      syncCharacterHandler(
        {
          auth,
          data: {
            character: {
              name: 'Nova',
              isPublic: 'true',
            },
          },
        } as never,
        buildDeps(),
      ),
    (err: unknown) =>
      err instanceof HttpsError &&
      err.code === 'invalid-argument' &&
      err.message.includes('character.isPublic must be a boolean'),
  )
})

test('syncCharacterHandler returns timestamps as ISO strings', async () => {
  const createdAt = new Date('2026-01-01T00:00:00.000Z')
  const updatedAt = new Date('2026-01-02T00:00:00.000Z')

  const result = await syncCharacterHandler(
    {
      auth,
      data: {
        character: {
          name: 'Nova',
        },
      },
    } as never,
    {
      userRepository: {
        findUserByFirebaseUid: async () => ({ id: 'user-1' }) as never,
      },
      subscriptionService: {
        getSubscription: async () => ({ planTier: 'monthly_20', planStatus: 'active' }) as never,
      },
      characterService: {
        upsertCharacter: async () =>
          ({
            id: 'character-1',
            userId: 'user-1',
            name: 'Nova',
            appearance: null,
            traits: null,
            emotions: null,
            context: null,
            isPublic: false,
            createdAt,
            updatedAt,
          }) as never,
      },
      creditService: {
        spendCredits: async () => [{ transactionId: 'tx-123', amount: 1 }],
        refundCredit: async () => {},
      },
    } as unknown as CharacterFunctionDeps,
  )

  assert.equal(typeof result.createdAt, 'string')
  assert.equal(typeof result.updatedAt, 'string')
  assert.equal(result.createdAt, createdAt.toISOString())
  assert.equal(result.updatedAt, updatedAt.toISOString())
})

test('syncCharacterHandler spends a credit before saving a cloud character', async () => {
  const auth = {
    uid: 'firebase-uid-2',
    token: {
      uid: 'firebase-uid-2',
      email: 'credit@example.com',
    },
  }
  let spent = false

  const result = await syncCharacterHandler(
    {
      auth,
      data: {
        character: {
          name: 'Nova',
        },
      },
    } as never,
    {
      userRepository: {
        findUserByFirebaseUid: async () => ({ id: 'user-2' }) as never,
      },
      subscriptionService: {
        getSubscription: async () => ({ planTier: 'payg', planStatus: 'active' }) as never,
      },
      characterService: {
        upsertCharacter: async () => ({ id: 'character-1' }) as never,
      },
      creditService: {
        spendCredits: async () => {
          spent = true
          return 'tx-123'
        },
        refundCredit: async () => {
          throw new Error('Should not refund when sync succeeds')
        },
      },
    } as unknown as CharacterFunctionDeps,
  )

  assert.equal((result as Record<string, unknown>).id, 'character-1')
  assert.equal(spent, true)
})

test('syncCharacterHandler refunds credit when character save fails', async () => {
  const auth = {
    uid: 'firebase-uid-3',
    token: {
      uid: 'firebase-uid-3',
      email: 'refund@example.com',
    },
  }
  let refunded = false

  await assert.rejects(
    async () =>
      syncCharacterHandler(
        {
          auth,
          data: {
            character: {
              name: 'Nova',
            },
          },
        } as never,
        {
          userRepository: {
            findUserByFirebaseUid: async () => ({ id: 'user-3' }) as never,
          },
          subscriptionService: {
            getSubscription: async () => ({ planTier: 'payg', planStatus: 'active' }) as never,
          },
          characterService: {
            upsertCharacter: async () => {
              throw new Error('DB unavailable')
            },
          },
          creditService: {
            spendCredits: async () => [{ transactionId: 'tx-456', amount: 1 }],
            refundCredit: async () => {
              refunded = true
            },
          },
        } as unknown as CharacterFunctionDeps,
      ),
    (err: unknown) => err instanceof HttpsError && err.code === 'internal',
  )

  assert.equal(refunded, true)
})

test('syncCharacterHandler rejects when insufficient credits', async () => {
  const auth = {
    uid: 'firebase-uid-4',
    token: {
      uid: 'firebase-uid-4',
      email: 'insufficient@example.com',
    },
  }

  await assert.rejects(
    async () =>
      syncCharacterHandler(
        {
          auth,
          data: {
            character: {
              name: 'Nova',
            },
          },
        } as never,
        {
          userRepository: {
            findUserByFirebaseUid: async () => ({ id: 'user-4' }) as never,
          },
          subscriptionService: {
            getSubscription: async () => ({ planTier: 'payg', planStatus: 'active' }) as never,
          },
          characterService: {
            upsertCharacter: async () => ({ id: 'character-1' }) as never,
          },
          creditService: {
            spendCredits: async () => null,
            refundCredit: async () => {
              throw new Error('Should not refund when spend fails')
            },
          },
        } as unknown as CharacterFunctionDeps,
      ),
    (err: unknown) => err instanceof HttpsError && err.code === 'failed-precondition',
  )
})

test('syncCharacterHandler ignores client-supplied createdAt and updatedAt', async () => {
  const receivedPayloads: Array<Record<string, unknown>> = []

  await syncCharacterHandler(
    {
      auth,
      data: {
        character: {
          name: 'Nova',
          createdAt: '1900-01-01T00:00:00.000Z',
          updatedAt: '3000-01-01T00:00:00.000Z',
        },
      },
    } as never,
    {
      userRepository: {
        findUserByFirebaseUid: async () => ({ id: 'user-1' }) as never,
      },
      subscriptionService: {
        getSubscription: async () => ({ planTier: 'monthly_20', planStatus: 'active' }) as never,
      },
      characterService: {
        upsertCharacter: async (payload: unknown) => {
          receivedPayloads.push(payload as Record<string, unknown>)
          return {
            id: 'character-1',
            userId: 'user-1',
            name: 'Nova',
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
            updatedAt: new Date('2026-01-02T00:00:00.000Z'),
          } as never
        },
      },
      creditService: {
        spendCredits: async () => [{ transactionId: 'tx-123', amount: 1 }],
        refundCredit: async () => {},
      },
    } as unknown as CharacterFunctionDeps,
  )

  assert.equal(receivedPayloads.length, 1)
  assert.equal(receivedPayloads[0]?.createdAt, undefined)
  assert.equal(receivedPayloads[0]?.updatedAt, undefined)
})

test('syncCharacterHandler defaults null voice to Aoede', async () => {
  const receivedPayloads: Array<Record<string, unknown>> = []

  await syncCharacterHandler(
    {
      auth,
      data: {
        character: {
          name: 'Nova',
          voice: null,
        },
      },
    } as never,
    {
      userRepository: {
        findUserByFirebaseUid: async () => ({ id: 'user-1' }) as never,
      },
      subscriptionService: {
        getSubscription: async () => ({ planTier: 'monthly_20', planStatus: 'active' }) as never,
      },
      characterService: {
        upsertCharacter: async (payload: unknown) => {
          receivedPayloads.push(payload as Record<string, unknown>)
          return {
            id: 'character-1',
            userId: 'user-1',
            name: 'Nova',
            voice: 'Aoede',
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
            updatedAt: new Date('2026-01-02T00:00:00.000Z'),
          } as never
        },
      },
      creditService: {
        spendCredits: async () => [{ transactionId: 'tx-123', amount: 1 }],
        refundCredit: async () => {},
      },
    } as unknown as CharacterFunctionDeps,
  )

  assert.equal(receivedPayloads[0]?.voice, 'Aoede')
})

test('syncCharacterHandler leaves voice undefined when omitted', async () => {
  const receivedPayloads: Array<Record<string, unknown>> = []

  await syncCharacterHandler(
    {
      auth,
      data: {
        character: {
          name: 'Nova',
        },
      },
    } as never,
    {
      userRepository: {
        findUserByFirebaseUid: async () => ({ id: 'user-1' }) as never,
      },
      subscriptionService: {
        getSubscription: async () => ({ planTier: 'monthly_20', planStatus: 'active' }) as never,
      },
      characterService: {
        upsertCharacter: async (payload: unknown) => {
          receivedPayloads.push(payload as Record<string, unknown>)
          return {
            id: 'character-1',
            userId: 'user-1',
            name: 'Nova',
            voice: 'Kore',
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
            updatedAt: new Date('2026-01-02T00:00:00.000Z'),
          } as never
        },
      },
      creditService: {
        spendCredits: async () => [{ transactionId: 'tx-123', amount: 1 }],
        refundCredit: async () => {},
      },
    } as unknown as CharacterFunctionDeps,
  )

  assert.equal(receivedPayloads.length, 1)
  assert.equal(receivedPayloads[0]?.voice, undefined)
})

test('syncCharacterHandler defaults empty voice string to Aoede', async () => {
  const receivedPayloads: Array<Record<string, unknown>> = []

  await syncCharacterHandler(
    {
      auth,
      data: {
        character: {
          name: 'Nova',
          voice: '   ',
        },
      },
    } as never,
    {
      userRepository: {
        findUserByFirebaseUid: async () => ({ id: 'user-1' }) as never,
      },
      subscriptionService: {
        getSubscription: async () => ({ planTier: 'monthly_20', planStatus: 'active' }) as never,
      },
      characterService: {
        upsertCharacter: async (payload: unknown) => {
          receivedPayloads.push(payload as Record<string, unknown>)
          return {
            id: 'character-1',
            userId: 'user-1',
            name: 'Nova',
            voice: 'Aoede',
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
            updatedAt: new Date('2026-01-02T00:00:00.000Z'),
          } as never
        },
      },
      creditService: {
        spendCredits: async () => [{ transactionId: 'tx-123', amount: 1 }],
        refundCredit: async () => {},
      },
    } as unknown as CharacterFunctionDeps,
  )

  assert.equal(receivedPayloads.length, 1)
  assert.equal(receivedPayloads[0]?.voice, 'Aoede')
})

test('getUserCharactersHandler returns character timestamps as ISO strings', async () => {
  const createdAt = new Date('2026-01-01T00:00:00.000Z')
  const updatedAt = new Date('2026-01-02T00:00:00.000Z')

  const result = await getUserCharactersHandler(
    {
      auth,
      data: {},
    } as never,
    {
      userRepository: {
        findUserByFirebaseUid: async () => ({ id: 'user-1' }) as never,
      },
      subscriptionService: {
        getSubscription: async () => ({ planTier: 'monthly_20', planStatus: 'active' }) as never,
      },
      characterService: {
        getUserCharacters: async () =>
          [
            {
              id: 'character-1',
              userId: 'user-1',
              name: 'Nova',
              appearance: null,
              traits: null,
              emotions: null,
              context: null,
              isPublic: false,
              createdAt,
              updatedAt,
            },
          ] as never,
      },
      characterImageService: {
        listImages: async () => [],
        listImagesByCharacters: async () => [],
      },
    } as unknown as CharacterFunctionDeps,
  )

  assert.equal(result.characters.length, 1)
  assert.equal(typeof result.characters[0]?.createdAt, 'string')
  assert.equal(typeof result.characters[0]?.updatedAt, 'string')
  assert.equal(result.characters[0]?.createdAt, createdAt.toISOString())
  assert.equal(result.characters[0]?.updatedAt, updatedAt.toISOString())
  assert.equal((result.characters[0] as Record<string, unknown>).ownerUserId, 'firebase-uid-1')
  assert.equal((result.characters[0] as Record<string, unknown>).userId, undefined)
})

test('syncCharacterHandler rejects invalid timestamp value types', async () => {
  await assert.rejects(
    async () =>
      syncCharacterHandler(
        {
          auth,
          data: {
            character: {
              name: 'Nova',
            },
          },
        } as never,
        {
          userRepository: {
            findUserByFirebaseUid: async () => ({ id: 'user-1' }) as never,
          },
          subscriptionService: {
            getSubscription: async () =>
              ({ planTier: 'monthly_20', planStatus: 'active' }) as never,
          },
          characterService: {
            upsertCharacter: async () =>
              ({
                id: 'character-1',
                userId: 'user-1',
                name: 'Nova',
                createdAt: { invalid: true },
                updatedAt: new Date('2026-01-02T00:00:00.000Z'),
              }) as never,
          },
          creditService: {
            spendCredits: async () => [{ transactionId: 'tx-123', amount: 1 }],
            refundCredit: async () => {},
          },
        } as unknown as CharacterFunctionDeps,
      ),
    (err: unknown) =>
      err instanceof HttpsError &&
      err.code === 'internal' &&
      err.message.includes('Failed to sync character'),
  )
})

test('syncCharacterHandler allows users without cloud-character subscription access', async () => {
  const result = await syncCharacterHandler(
    {
      auth,
      data: {
        character: {
          name: 'Nova',
        },
      },
    } as never,
    {
      userRepository: {
        findUserByFirebaseUid: async () => ({ id: 'user-1' }) as never,
      },
      characterService: {
        upsertCharacter: async () => ({ id: 'character-1' }) as never,
      },
      creditService: {
        spendCredits: async () => [{ transactionId: 'tx-123', amount: 1 }],
        refundCredit: async () => {},
      },
    } as unknown as CharacterFunctionDeps,
  )

  assert.equal((result as Record<string, unknown>).id, 'character-1')
  assert.equal((result as Record<string, unknown>).ownerUserId, 'firebase-uid-1')
})

test('getUserCharactersHandler allows users without cloud-character subscription access', async () => {
  const result = await getUserCharactersHandler(
    {
      auth,
      data: {},
    } as never,
    {
      userRepository: {
        findUserByFirebaseUid: async () => ({ id: 'user-1' }) as never,
      },
      characterService: {
        getUserCharacters: async () =>
          [
            {
              id: 'character-1',
              userId: 'user-1',
              name: 'Nova',
              appearance: null,
              traits: null,
              emotions: null,
              context: null,
              isPublic: false,
              createdAt: new Date('2026-01-01T00:00:00.000Z'),
              updatedAt: new Date('2026-01-02T00:00:00.000Z'),
            },
          ] as never,
      },
      characterImageService: {
        listImages: async () => [],
        listImagesByCharacters: async () => [],
      },
    } as unknown as CharacterFunctionDeps,
  )

  assert.equal(result.characters.length, 1)
  assert.equal(result.characters[0]?.ownerUserId, 'firebase-uid-1')
})

test('getPublicCharacterHandler allows users without cloud-character subscription access', async () => {
  const result = await getPublicCharacterHandler(
    {
      auth,
      data: {
        characterId: '123e4567-e89b-42d3-a456-426614174000',
      },
    } as never,
    {
      userRepository: {
        findUserByFirebaseUid: async () => ({ id: 'user-1' }) as never,
      },
      characterService: {
        getPublicCharacterWithOwner: async () =>
          ({
            character: {
              id: 'character-1',
              userId: 'user-1',
              name: 'Nova',
              appearance: null,
              traits: null,
              emotions: null,
              context: null,
              isPublic: true,
              createdAt: new Date('2026-01-01T00:00:00.000Z'),
              updatedAt: new Date('2026-01-02T00:00:00.000Z'),
            },
            ownerFirebaseUid: 'firebase-uid-1',
          }) as never,
      },
    } as unknown as CharacterFunctionDeps,
  )

  assert.equal((result as Record<string, unknown>).id, 'character-1')
  assert.equal((result as Record<string, unknown>).name, 'Nova')
})
test('getPublicCharacterHandler returns shared public character', async () => {
  const createdAt = new Date('2026-01-01T00:00:00.000Z')
  const updatedAt = new Date('2026-01-02T00:00:00.000Z')
  const result = await getPublicCharacterHandler(
    {
      auth,
      data: {
        characterId: '123e4567-e89b-42d3-a456-426614174000',
      },
    } as never,
    {
      userRepository: {
        findUserByFirebaseUid: async () => ({ id: 'user-1' }) as never,
      },
      subscriptionService: {
        getSubscription: async () => ({ planTier: 'monthly_50', planStatus: 'active' }) as never,
      },
      characterService: {
        getPublicCharacterWithOwner: async () =>
          ({
            character: {
              id: '123e4567-e89b-42d3-a456-426614174000',
              userId: 'owner-1',
              name: 'Nova',
              appearance: 'Tall',
              traits: 'Calm',
              emotions: 'Happy',
              context: 'Shared',
              isPublic: true,
              createdAt,
              updatedAt,
            },
            ownerFirebaseUid: 'owner-firebase-uid',
          }) as never,
      },
    } as unknown as CharacterFunctionDeps,
  )

  const payload = result as Record<string, unknown>
  assert.equal(payload.id, '123e4567-e89b-42d3-a456-426614174000')
  assert.equal(payload.name, 'Nova')
  assert.equal(payload.createdAt, createdAt.toISOString())
  assert.equal(payload.updatedAt, updatedAt.toISOString())
  assert.equal(payload.ownerUserId, 'owner-firebase-uid')
  assert.equal(payload.userId, undefined)
})

test('syncCharacterHandler rejects when character belongs to another user', async () => {
  await assert.rejects(
    async () =>
      syncCharacterHandler(
        {
          auth,
          data: {
            character: {
              id: '00000000-0000-4000-8000-000000000001',
              name: 'Nova',
            },
          },
        } as never,
        {
          userRepository: {
            findUserByFirebaseUid: async () => ({ id: 'user-1' }) as never,
          },
          subscriptionService: {
            getSubscription: async () =>
              ({ planTier: 'monthly_20', planStatus: 'active' }) as never,
          },
          characterService: {
            upsertCharacter: async () => {
              throw new CharacterOwnershipError()
            },
          },
          creditService: {
            spendCredits: async () => [{ transactionId: 'tx-123', amount: 1 }],
            refundCredit: async () => {},
          },
        } as unknown as CharacterFunctionDeps,
      ),
    (err: unknown) =>
      err instanceof HttpsError &&
      err.code === 'permission-denied' &&
      err.message.includes('does not belong to authenticated user'),
  )
})

test('deleteCharacterHandler rejects when character belongs to another user', async () => {
  await assert.rejects(
    async () =>
      deleteCharacterHandler(
        {
          auth,
          data: {
            characterId: '00000000-0000-4000-8000-000000000001',
          },
        } as never,
        {
          userRepository: {
            findUserByFirebaseUid: async () => ({ id: 'user-1' }) as never,
          },
          subscriptionService: {
            getSubscription: async () =>
              ({ planTier: 'monthly_20', planStatus: 'active' }) as never,
          },
          characterService: {
            assertCharacterOwnership: async () => {
              throw new CharacterOwnershipError()
            },
            deleteCharacter: async () => {
              throw new Error('deleteCharacter should not be reached')
            },
          },
          characterImageService: {
            purgeCharacter: async () => {
              throw new Error('purgeCharacter should not be reached')
            },
          },
        } as unknown as CharacterFunctionDeps,
      ),
    (err: unknown) =>
      err instanceof HttpsError &&
      err.code === 'permission-denied' &&
      err.message.includes('does not belong to authenticated user'),
  )
})

test('syncCharacterHandler response includes ownerUserId', async () => {
  const result = await syncCharacterHandler(
    {
      auth,
      data: {
        character: {
          name: 'Nova',
        },
      },
    } as never,
    {
      userRepository: {
        findUserByFirebaseUid: async () => ({ id: 'user-1' }) as never,
      },
      subscriptionService: {
        getSubscription: async () => ({ planTier: 'monthly_20', planStatus: 'active' }) as never,
      },
      characterService: {
        upsertCharacter: async () =>
          ({
            id: 'character-1',
            userId: 'user-1',
            name: 'Nova',
            appearance: null,
            traits: null,
            emotions: null,
            context: null,
            isPublic: false,
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
            updatedAt: new Date('2026-01-02T00:00:00.000Z'),
          }) as never,
      },
      creditService: {
        spendCredits: async () => [{ transactionId: 'tx-123', amount: 1 }],
        refundCredit: async () => {},
      },
    } as unknown as CharacterFunctionDeps,
  )

  assert.equal((result as Record<string, unknown>).ownerUserId, 'firebase-uid-1')
  assert.equal((result as Record<string, unknown>).userId, undefined)
})

function imageDeps(overrides: Record<string, unknown> = {}) {
  return {
    userRepository: {
      findUserByFirebaseUid: async () => ({ id: 'user-uuid', firebaseUid: 'uid-1' }),
    },
    characterService: {
      isOwnedByUser: async () => true,
    },
    characterImageService: {
      syncImages: async () => ({ evictedImageIds: [] }),
      deleteImages: async () => {},
      listImages: async () => [],
      setActiveImage: async () => {},
      ...overrides,
    },
  }
}

const CHAR_ID = '11111111-1111-4111-8111-111111111111'
const IMG_ID = '22222222-2222-4222-8222-222222222222'

function imageRequest(data: unknown) {
  return { auth: { uid: 'uid-1' }, data } as never
}

test('syncCharacterImages rejects unauthenticated calls', async () => {
  await assert.rejects(
    () => syncCharacterImagesHandler({ data: {} } as never, imageDeps() as never),
    (e: unknown) => e instanceof HttpsError && e.code === 'unauthenticated',
  )
})

test('syncCharacterImages requires a uuid characterId', async () => {
  await assert.rejects(
    () =>
      syncCharacterImagesHandler(imageRequest({ characterId: 'char_local' }), imageDeps() as never),
    (e: unknown) => e instanceof HttpsError && e.code === 'invalid-argument',
  )
})

test('syncCharacterImages rejects images whose id is not a uuid', async () => {
  await assert.rejects(
    () =>
      syncCharacterImagesHandler(
        imageRequest({
          characterId: CHAR_ID,
          images: [{ id: 'nope', storagePath: 'p', source: 'generated' }],
        }),
        imageDeps() as never,
      ),
    (e: unknown) => e instanceof HttpsError && e.code === 'invalid-argument',
  )
})

test("syncCharacterImages refuses a storagePath outside the caller's own tree", async () => {
  await assert.rejects(
    () =>
      syncCharacterImagesHandler(
        imageRequest({
          characterId: CHAR_ID,
          images: [
            {
              id: IMG_ID,
              storagePath: 'users/someone-else/characters/x/i.webp',
              source: 'generated',
            },
          ],
        }),
        imageDeps() as never,
      ),
    (e: unknown) => e instanceof HttpsError && e.code === 'permission-denied',
  )
})

test('syncCharacterImages returns evicted ids so the client can apply them', async () => {
  const deps = imageDeps({ syncImages: async () => ({ evictedImageIds: ['old-1'] }) })
  const result = await syncCharacterImagesHandler(
    imageRequest({
      characterId: CHAR_ID,
      images: [
        {
          id: IMG_ID,
          storagePath: `users/uid-1/characters/${CHAR_ID}/${IMG_ID}.webp`,
          source: 'generated',
        },
      ],
    }),
    deps as never,
  )
  assert.deepEqual(result.evictedImageIds, ['old-1'])
})

test('syncCharacterImages returns the full set including tombstones', async () => {
  const deps = imageDeps({
    listImages: async () => [
      {
        id: IMG_ID,
        characterId: CHAR_ID,
        storagePath: 'p',
        thumbPath: 't',
        mimeType: 'image/webp',
        source: 'generated',
        createdAt: new Date(0),
        deletedAt: null,
      },
      {
        id: '33333333-3333-4333-8333-333333333333',
        characterId: CHAR_ID,
        storagePath: 'p2',
        thumbPath: null,
        mimeType: 'image/webp',
        source: 'generated',
        createdAt: new Date(0),
        deletedAt: new Date(1),
      },
    ],
  })
  const result = await syncCharacterImagesHandler(
    imageRequest({ characterId: CHAR_ID, images: [] }),
    deps as never,
  )
  assert.equal(result.images.length, 2)
  assert.equal(result.images[1].deletedAt, new Date(1).toISOString())
})

test('syncCharacterImages refuses a character the caller does not own', async () => {
  const deps = imageDeps()
  deps.characterService.isOwnedByUser = async () => false
  await assert.rejects(
    () =>
      syncCharacterImagesHandler(imageRequest({ characterId: CHAR_ID, images: [] }), deps as never),
    (e: unknown) => e instanceof HttpsError && e.code === 'permission-denied',
  )
})

test("syncCharacterImages rejects an activeImageId that is not one of the character's own images", async () => {
  const deps = imageDeps({
    listImages: async () => [
      {
        id: IMG_ID,
        characterId: CHAR_ID,
        storagePath: 'p',
        thumbPath: null,
        mimeType: 'image/webp',
        source: 'generated',
        createdAt: new Date(0),
        deletedAt: null,
      },
    ],
    setActiveImage: async () => {
      throw new Error('setActiveImage should not be called for an unowned activeImageId')
    },
  })
  const foreignImageId = '44444444-4444-4444-8444-444444444444'
  await assert.rejects(
    () =>
      syncCharacterImagesHandler(
        imageRequest({ characterId: CHAR_ID, images: [], activeImageId: foreignImageId }),
        deps as never,
      ),
    (e: unknown) => e instanceof HttpsError && e.code === 'permission-denied',
  )
})

test('syncCharacterImages accepts an activeImageId that belongs to the character', async () => {
  let setActiveCalledWith: [string, string] | null = null
  const deps = imageDeps({
    listImages: async () => [
      {
        id: IMG_ID,
        characterId: CHAR_ID,
        storagePath: 'p',
        thumbPath: null,
        mimeType: 'image/webp',
        source: 'generated',
        createdAt: new Date(0),
        deletedAt: null,
      },
    ],
    setActiveImage: async (characterId: string, imageId: string) => {
      setActiveCalledWith = [characterId, imageId]
    },
  })
  await syncCharacterImagesHandler(
    imageRequest({ characterId: CHAR_ID, images: [], activeImageId: IMG_ID }),
    deps as never,
  )
  assert.deepEqual(setActiveCalledWith, [CHAR_ID, IMG_ID])
})

test('syncCharacterImages rejects an activeImageId that matches only a tombstoned row', async () => {
  const deps = imageDeps({
    listImages: async () => [
      {
        id: IMG_ID,
        characterId: CHAR_ID,
        storagePath: 'p',
        thumbPath: null,
        mimeType: 'image/webp',
        source: 'generated',
        createdAt: new Date(0),
        deletedAt: new Date(1),
      },
    ],
    setActiveImage: async () => {
      throw new Error('setActiveImage should not be called for a tombstoned activeImageId')
    },
  })
  await assert.rejects(
    () =>
      syncCharacterImagesHandler(
        imageRequest({ characterId: CHAR_ID, images: [], activeImageId: IMG_ID }),
        deps as never,
      ),
    (e: unknown) => e instanceof HttpsError && e.code === 'permission-denied',
  )
})

test('getUserCharacters includes images and activeImageId', async () => {
  const deps = buildDeps()
  deps.userRepository.findUserByFirebaseUid = async () => ({ id: 'user-uuid' }) as never
  deps.characterService.getUserCharacters = async () => [
    { id: CHAR_ID, userId: 'user-uuid', name: 'C', activeImageId: IMG_ID } as never,
  ]
  ;(deps as Record<string, unknown>).characterImageService = {
    listImages: async () => [
      {
        id: IMG_ID,
        characterId: CHAR_ID,
        storagePath: 'p',
        thumbPath: 't',
        mimeType: 'image/webp',
        source: 'generated',
        createdAt: new Date(0),
        deletedAt: null,
      },
    ],
    listImagesByCharacters: async () => [
      {
        id: IMG_ID,
        characterId: CHAR_ID,
        storagePath: 'p',
        thumbPath: 't',
        mimeType: 'image/webp',
        source: 'generated',
        createdAt: new Date(0),
        deletedAt: null,
      },
    ],
    syncImages: async () => ({ evictedImageIds: [] }),
    deleteImages: async () => {},
    setActiveImage: async () => {},
  }
  const result = await getUserCharactersHandler(imageRequest({}), deps as never)
  assert.equal(result.characters[0].activeImageId, IMG_ID)
  assert.equal(result.characters[0].images.length, 1)
})

test("deleteCharacter prefix-deletes the character's storage objects", async () => {
  const prefixes: string[] = []
  const deps = buildDeps()
  deps.userRepository.findUserByFirebaseUid = async () =>
    ({ id: 'user-uuid', firebaseUid: 'uid-1' }) as never
  deps.characterService.deleteCharacter = async () => undefined as never
  ;(deps as Record<string, unknown>).characterImageService = {
    purgeCharacter: async (uid: string, _dbUserId: string, characterId: string) => {
      prefixes.push(`${uid}/${characterId}`)
    },
    syncImages: async () => ({ evictedImageIds: [] }),
    deleteImages: async () => {},
    listImages: async () => [],
    setActiveImage: async () => {},
  }
  await deleteCharacterHandler(
    { auth: { uid: 'uid-1' }, data: { characterId: CHAR_ID } } as never,
    deps as never,
  )
  assert.deepEqual(prefixes, [`uid-1/${CHAR_ID}`])
})

test('deleteCharacter purges images before dropping the character row', async () => {
  const order: string[] = []
  const deps = buildDeps()
  deps.userRepository.findUserByFirebaseUid = async () =>
    ({ id: 'user-uuid', firebaseUid: 'uid-1' }) as never
  deps.characterService.deleteCharacter = async () => {
    order.push('character')
    return undefined as never
  }
  ;(deps as Record<string, unknown>).characterImageService = {
    purgeCharacter: async () => {
      order.push('images')
    },
    syncImages: async () => ({ evictedImageIds: [] }),
    deleteImages: async () => {},
    listImages: async () => [],
    setActiveImage: async () => {},
  }
  await deleteCharacterHandler(
    { auth: { uid: 'uid-1' }, data: { characterId: CHAR_ID } } as never,
    deps as never,
  )
  assert.deepEqual(order, ['images', 'character'])
})

test("getPublicCharacter returns a signed URL for the owner's active image", async () => {
  const deps = buildDeps()
  deps.userRepository.findUserByFirebaseUid = async () => ({ id: 'user-uuid' }) as never
  deps.characterService.getPublicCharacterWithOwner = async () =>
    ({
      character: { id: CHAR_ID, name: 'C', isPublic: true, activeImageId: IMG_ID },
      ownerFirebaseUid: 'owner-uid',
    }) as never
  ;(deps as Record<string, unknown>).characterImageService = {
    listImages: async () => [
      {
        id: IMG_ID,
        characterId: CHAR_ID,
        storagePath: 'users/owner-uid/characters/c/i.webp',
        thumbPath: null,
        mimeType: 'image/webp',
        source: 'generated',
        createdAt: new Date(0),
        deletedAt: null,
      },
    ],
    syncImages: async () => ({ evictedImageIds: [] }),
    deleteImages: async () => {},
    setActiveImage: async () => {},
  }
  ;(deps as Record<string, unknown>).storageAdmin = {
    createSignedUrl: async (p: string) => `https://signed/${p}`,
    deletePrefix: async () => {},
    deleteObjects: async () => {},
  }
  const result = await getPublicCharacterHandler(
    { auth: { uid: 'importer-uid' }, data: { characterId: CHAR_ID } } as never,
    deps as never,
  )
  assert.equal(result.avatarSignedUrl, 'https://signed/users/owner-uid/characters/c/i.webp')
})

test('getPublicCharacter returns null when the character has no active image', async () => {
  const deps = buildDeps()
  deps.userRepository.findUserByFirebaseUid = async () => ({ id: 'user-uuid' }) as never
  deps.characterService.getPublicCharacterWithOwner = async () =>
    ({
      character: { id: CHAR_ID, name: 'C', isPublic: true, activeImageId: null },
      ownerFirebaseUid: 'owner-uid',
    }) as never
  ;(deps as Record<string, unknown>).characterImageService = {
    listImages: async () => [],
    syncImages: async () => ({ evictedImageIds: [] }),
    deleteImages: async () => {},
    setActiveImage: async () => {},
  }
  const result = await getPublicCharacterHandler(
    { auth: { uid: 'importer-uid' }, data: { characterId: CHAR_ID } } as never,
    deps as never,
  )
  assert.equal(result.avatarSignedUrl, null)
})

test('getPublicCharacter does not sign a tombstoned image', async () => {
  const deps = buildDeps()
  deps.userRepository.findUserByFirebaseUid = async () => ({ id: 'user-uuid' }) as never
  deps.characterService.getPublicCharacterWithOwner = async () =>
    ({
      character: { id: CHAR_ID, name: 'C', isPublic: true, activeImageId: IMG_ID },
      ownerFirebaseUid: 'owner-uid',
    }) as never
  ;(deps as Record<string, unknown>).characterImageService = {
    listImages: async () => [
      {
        id: IMG_ID,
        characterId: CHAR_ID,
        storagePath: 'p',
        thumbPath: null,
        mimeType: 'image/webp',
        source: 'generated',
        createdAt: new Date(0),
        deletedAt: new Date(1),
      },
    ],
    syncImages: async () => ({ evictedImageIds: [] }),
    deleteImages: async () => {},
    setActiveImage: async () => {},
  }
  const result = await getPublicCharacterHandler(
    { auth: { uid: 'importer-uid' }, data: { characterId: CHAR_ID } } as never,
    deps as never,
  )
  assert.equal(result.avatarSignedUrl, null)
})

test('a signing failure does not fail the whole import', async () => {
  const deps = buildDeps()
  deps.userRepository.findUserByFirebaseUid = async () => ({ id: 'user-uuid' }) as never
  deps.characterService.getPublicCharacterWithOwner = async () =>
    ({
      character: { id: CHAR_ID, name: 'C', isPublic: true, activeImageId: IMG_ID },
      ownerFirebaseUid: 'owner-uid',
    }) as never
  ;(deps as Record<string, unknown>).characterImageService = {
    listImages: async () => [
      {
        id: IMG_ID,
        characterId: CHAR_ID,
        storagePath: 'p',
        thumbPath: null,
        mimeType: 'image/webp',
        source: 'generated',
        createdAt: new Date(0),
        deletedAt: null,
      },
    ],
    syncImages: async () => ({ evictedImageIds: [] }),
    deleteImages: async () => {},
    setActiveImage: async () => {},
  }
  ;(deps as Record<string, unknown>).storageAdmin = {
    createSignedUrl: async () => {
      throw new Error('signBlob permission denied')
    },
    deletePrefix: async () => {},
    deleteObjects: async () => {},
  }
  const result = await getPublicCharacterHandler(
    { auth: { uid: 'importer-uid' }, data: { characterId: CHAR_ID } } as never,
    deps as never,
  )
  assert.equal(result.avatarSignedUrl, null)
  assert.equal((result as Record<string, unknown>).name, 'C')
})

test('a listImages failure does not fail the whole import either', async () => {
  const deps = buildDeps()
  deps.userRepository.findUserByFirebaseUid = async () => ({ id: 'user-uuid' }) as never
  deps.characterService.getPublicCharacterWithOwner = async () =>
    ({
      character: { id: CHAR_ID, name: 'C', isPublic: true, activeImageId: IMG_ID },
      ownerFirebaseUid: 'owner-uid',
    }) as never
  ;(deps as Record<string, unknown>).characterImageService = {
    listImages: async () => {
      throw new Error('db blip')
    },
    syncImages: async () => ({ evictedImageIds: [] }),
    deleteImages: async () => {},
    setActiveImage: async () => {},
  }
  const result = await getPublicCharacterHandler(
    { auth: { uid: 'importer-uid' }, data: { characterId: CHAR_ID } } as never,
    deps as never,
  )
  assert.equal(result.avatarSignedUrl, null)
  assert.equal((result as Record<string, unknown>).name, 'C')
})

test('syncCharacterImages rejects an unsupported image mimeType', async () => {
  await assert.rejects(
    () =>
      syncCharacterImagesHandler(
        imageRequest({
          characterId: CHAR_ID,
          images: [
            {
              id: IMG_ID,
              storagePath: `users/uid-1/characters/${CHAR_ID}/${IMG_ID}.webp`,
              source: 'generated',
              mimeType: 'image/svg+xml',
            },
          ],
        }),
        imageDeps() as never,
      ),
    (e: unknown) => e instanceof HttpsError && e.code === 'invalid-argument',
  )
})

test('syncCharacterImages still defaults mimeType when the client omits it', async () => {
  let received: Record<string, unknown> | null = null
  const deps = imageDeps({
    syncImages: async (_c: string, _u: string, rows: Record<string, unknown>[]) => {
      received = rows[0] ?? null
      return { evictedImageIds: [] }
    },
  })
  await syncCharacterImagesHandler(
    imageRequest({
      characterId: CHAR_ID,
      images: [
        {
          id: IMG_ID,
          storagePath: `users/uid-1/characters/${CHAR_ID}/${IMG_ID}.webp`,
          source: 'generated',
        },
      ],
    }),
    deps as never,
  )
  assert.equal((received as unknown as { mimeType: string }).mimeType, 'image/webp')
})

test('syncCharacterImages caps the number of images accepted per request', async () => {
  const oversized = Array.from({ length: 200 }, () => ({
    id: IMG_ID,
    storagePath: `users/uid-1/characters/${CHAR_ID}/${IMG_ID}.webp`,
    source: 'generated',
  }))
  await assert.rejects(
    () =>
      syncCharacterImagesHandler(
        imageRequest({ characterId: CHAR_ID, images: oversized }),
        imageDeps() as never,
      ),
    (e: unknown) => e instanceof HttpsError && e.code === 'invalid-argument',
  )
})

test('syncCharacterImages caps the number of deletions accepted per request', async () => {
  const oversized = Array.from({ length: 200 }, () => IMG_ID)
  await assert.rejects(
    () =>
      syncCharacterImagesHandler(
        imageRequest({ characterId: CHAR_ID, images: [], deletedImageIds: oversized }),
        imageDeps() as never,
      ),
    (e: unknown) => e instanceof HttpsError && e.code === 'invalid-argument',
  )
})

test('syncCharacterImages clears the active pointer when the client sends null', async () => {
  let setActiveCalledWith: [string, string | null] | null = null
  const deps = imageDeps({
    setActiveImage: async (characterId: string, imageId: string | null) => {
      setActiveCalledWith = [characterId, imageId]
    },
  })
  await syncCharacterImagesHandler(
    imageRequest({ characterId: CHAR_ID, images: [], activeImageId: null }),
    deps as never,
  )
  assert.deepEqual(setActiveCalledWith, [CHAR_ID, null])
})

test('syncCharacterImages leaves the active pointer alone when activeImageId is absent', async () => {
  const deps = imageDeps({
    setActiveImage: async () => {
      throw new Error('setActiveImage should not be called when activeImageId is absent')
    },
  })
  await syncCharacterImagesHandler(
    imageRequest({ characterId: CHAR_ID, images: [] }),
    deps as never,
  )
})

test('syncCharacterImages rejects a malformed activeImageId instead of ignoring it', async () => {
  const deps = imageDeps({
    setActiveImage: async () => {
      throw new Error('setActiveImage should not be called for a malformed activeImageId')
    },
  })
  await assert.rejects(
    () =>
      syncCharacterImagesHandler(
        imageRequest({ characterId: CHAR_ID, images: [], activeImageId: 42 }),
        deps as never,
      ),
    (e: unknown) => e instanceof HttpsError && e.code === 'invalid-argument',
  )
})

test("syncCharacterImages accepts source 'chat' with a messageId", async () => {
  let received: Record<string, unknown> | null = null
  const deps = imageDeps({
    syncImages: async (_c: string, _u: string, rows: Record<string, unknown>[]) => {
      received = rows[0] ?? null
      return { evictedImageIds: [] }
    },
  })
  await syncCharacterImagesHandler(
    imageRequest({
      characterId: CHAR_ID,
      images: [
        {
          id: IMG_ID,
          storagePath: `users/uid-1/characters/${CHAR_ID}/${IMG_ID}.webp`,
          thumbPath: null,
          mimeType: 'image/webp',
          source: 'chat',
          messageId: 'msg_1723300000000_ab12cd',
        },
      ],
    }),
    deps as never,
  )

  assert.equal(
    (received as unknown as { messageId: unknown }).messageId,
    'msg_1723300000000_ab12cd',
  )
})

test('syncCharacterImages defaults messageId to null for avatars', async () => {
  let received: Record<string, unknown> | null = null
  const deps = imageDeps({
    syncImages: async (_c: string, _u: string, rows: Record<string, unknown>[]) => {
      received = rows[0] ?? null
      return { evictedImageIds: [] }
    },
  })
  await syncCharacterImagesHandler(
    imageRequest({
      characterId: CHAR_ID,
      images: [
        {
          id: IMG_ID,
          storagePath: `users/uid-1/characters/${CHAR_ID}/${IMG_ID}.webp`,
          source: 'uploaded',
        },
      ],
    }),
    deps as never,
  )

  assert.equal((received as unknown as { messageId: unknown }).messageId, null)
})

test('syncCharacterImages rejects a non-string messageId', async () => {
  await assert.rejects(
    () =>
      syncCharacterImagesHandler(
        imageRequest({
          characterId: CHAR_ID,
          images: [
            {
              id: IMG_ID,
              storagePath: `users/uid-1/characters/${CHAR_ID}/${IMG_ID}.webp`,
              source: 'chat',
              messageId: 42,
            },
          ],
        }),
        imageDeps() as never,
      ),
    (e: unknown) =>
      e instanceof HttpsError && e.code === 'invalid-argument' && /messageId/.test(e.message),
  )
})
