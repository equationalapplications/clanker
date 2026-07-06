import { dedupeEventsAgainstExisting, scanExplicitEventIds } from '../okfImportDedupe'
import type { MemoryDump, WikiMemory } from '@equationalapplications/expo-llm-wiki'
import { loadOkfFixture } from './okfFixtures'

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

describe('scanExplicitEventIds', () => {
  it('collects every id from a multi-line log, not just the last (multiline anchoring)', () => {
    const files = [
      {
        path: 'entities/e1/log.md',
        content: [
          '## 2026-07-05',
          '',
          '- (observation) First <!-- id: evt_one -->',
          '- (observation) No id on this line',
          '- (action) Third   <!--   id:   evt_three   -->  ',
        ].join('\n'),
      },
    ]
    expect(scanExplicitEventIds(files)).toEqual(new Set(['evt_one', 'evt_three']))
  })

  it('finds ids in the golden-v1 fixture log', () => {
    const ids = scanExplicitEventIds(loadOkfFixture('golden-v1'))
    expect(ids).toEqual(new Set(['evt_golden_1', 'evt_golden_2']))
  })

  it('finds none in the legacy-profile-0 fixture', () => {
    expect(scanExplicitEventIds(loadOkfFixture('legacy-profile-0')).size).toBe(0)
  })

  it('ignores non-log files', () => {
    const files = [{ path: 'entities/e1/facts/f.md', content: 'x <!-- id: evt_nope -->' }]
    expect(scanExplicitEventIds(files).size).toBe(0)
  })

  it('scans a log.md at the bundle root, not just nested entity logs', () => {
    const files = [
      { path: 'log.md', content: '- (observation) Root-level entry <!-- id: evt_root -->' },
    ]
    expect(scanExplicitEventIds(files)).toEqual(new Set(['evt_root']))
  })
})
