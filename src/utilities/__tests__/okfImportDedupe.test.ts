import { dedupeEventsAgainstExisting } from '../okfImportDedupe'
import type { MemoryDump, WikiMemory } from '@equationalapplications/expo-llm-wiki'

function buildDump(events: unknown[]): MemoryDump {
  return {
    generatedAt: 1783094400000,
    entities: {
      char_1: { facts: [], tasks: [], events, edges: [] },
    },
  } as unknown as MemoryDump
}

describe('dedupeEventsAgainstExisting', () => {
  it('drops events whose (event_type, summary, UTC day) already exists on the target entity', async () => {
    const existingEvent = {
      id: 'evt_existing',
      entity_id: 'char_1',
      event_type: 'observation',
      summary: 'User mentioned liking coffee',
      created_at: Date.parse('2026-07-04T10:00:00.000Z'),
      related_entry_id: null,
    }
    const duplicateFromBundle = {
      id: 'evt_new_but_same', // parseOkfBundle always regenerates event ids
      entity_id: 'char_1',
      event_type: 'observation',
      summary: 'User mentioned liking coffee',
      created_at: Date.parse('2026-07-04T15:30:00.000Z'), // same UTC day, different time
      related_entry_id: null,
    }

    const mockWiki = {
      exportDump: jest.fn().mockResolvedValue(buildDump([existingEvent])),
    } as unknown as WikiMemory

    const result = await dedupeEventsAgainstExisting(
      mockWiki,
      'char_1',
      buildDump([duplicateFromBundle]),
    )

    expect(result.entities.char_1.events).toHaveLength(0)
  })

  it('keeps events that genuinely differ in type, summary, or day', async () => {
    const existingEvent = {
      id: 'evt_existing',
      entity_id: 'char_1',
      event_type: 'observation',
      summary: 'User mentioned liking coffee',
      created_at: Date.parse('2026-07-04T10:00:00.000Z'),
      related_entry_id: null,
    }
    const differentEvent = {
      id: 'evt_different',
      entity_id: 'char_1',
      event_type: 'decision',
      summary: 'User decided to switch to tea',
      created_at: Date.parse('2026-07-05T10:00:00.000Z'),
      related_entry_id: null,
    }

    const mockWiki = {
      exportDump: jest.fn().mockResolvedValue(buildDump([existingEvent])),
    } as unknown as WikiMemory

    const result = await dedupeEventsAgainstExisting(mockWiki, 'char_1', buildDump([differentEvent]))

    expect(result.entities.char_1.events).toHaveLength(1)
    expect((result.entities.char_1.events[0] as { id: string }).id).toBe('evt_different')
  })

  it('skips the existing-events lookup entirely when the bundle has no events', async () => {
    const mockWiki = { exportDump: jest.fn() } as unknown as WikiMemory

    const result = await dedupeEventsAgainstExisting(mockWiki, 'char_1', buildDump([]))

    expect(mockWiki.exportDump).not.toHaveBeenCalled()
    expect(result.entities.char_1.events).toHaveLength(0)
  })
})
