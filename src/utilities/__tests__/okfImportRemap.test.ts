import { remapOkfDumpIds } from '../okfImportRemap'
import { randomUUID } from 'expo-crypto'
import { parseOkfBundle } from '@equationalapplications/expo-llm-wiki'
import type { MemoryDump } from '@equationalapplications/expo-llm-wiki'
import { loadOkfFixture } from './okfFixtures'

jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(),
}))

const mockRandomUUID = jest.mocked(randomUUID)

function buildDump(): MemoryDump {
  return {
    generatedAt: 1783094400000,
    entities: {
      char_new: {
        facts: [
          { id: 'fact_1', entity_id: 'char_new' } as any,
          { id: 'fact_2', entity_id: 'char_new' } as any,
        ],
        tasks: [{ id: 'task_1', entity_id: 'char_new' } as any],
        events: [
          { id: 'evt_1', entity_id: 'char_new', related_entry_id: 'fact_1' } as any,
          { id: 'evt_2', entity_id: 'char_new', related_entry_id: null } as any,
        ],
        edges: [
          {
            id: 'edge_1',
            entity_id: 'char_new',
            source_id: 'fact_1',
            target_id: 'fact_2',
            edge_type: 'related_to',
          } as any,
          {
            id: 'edge_2',
            entity_id: 'char_new',
            source_id: 'fact_1',
            target_id: 'nonexistent',
            edge_type: 'related_to',
          } as any,
        ],
      },
    },
  }
}

describe('remapOkfDumpIds', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    let counter = 0
    mockRandomUUID.mockImplementation(() => `new-${++counter}` as ReturnType<typeof randomUUID>)
  })

  it('assigns new ids to every fact and task, old ids fully absent', () => {
    const result = remapOkfDumpIds(buildDump(), 'char_new')
    const entity = result.entities.char_new

    const factIds = entity.facts.map((f) => f.id)
    const taskIds = entity.tasks.map((t) => t.id)

    expect(factIds).not.toContain('fact_1')
    expect(factIds).not.toContain('fact_2')
    expect(taskIds).not.toContain('task_1')
    expect(new Set([...factIds, ...taskIds]).size).toBe(3)
  })

  it('rewrites edge source_id/target_id through the id map', () => {
    const result = remapOkfDumpIds(buildDump(), 'char_new')
    const entity = result.entities.char_new
    const [newFact1, newFact2] = entity.facts

    const survivingEdge = entity.edges?.find((e) => e.source_id === newFact1.id)
    expect(survivingEdge?.target_id).toBe(newFact2.id)
  })

  it('drops an edge whose endpoint id is not in the map instead of leaving it dangling', () => {
    const result = remapOkfDumpIds(buildDump(), 'char_new')
    expect(result.entities.char_new.edges).toHaveLength(1)
  })

  it('rewrites an event related_entry_id through the id map', () => {
    // Event ids are regenerated on remap (profile v1 preserves source ids, so
    // the originals can't survive a clone-beside-source without colliding),
    // so look up by original array position rather than by old id.
    const result = remapOkfDumpIds(buildDump(), 'char_new')
    const entity = result.entities.char_new
    const [newFact1] = entity.facts
    const [evt1] = entity.events
    expect(evt1?.related_entry_id).toBe(newFact1.id)
  })

  it('leaves a null related_entry_id alone', () => {
    const result = remapOkfDumpIds(buildDump(), 'char_new')
    const [, evt2] = result.entities.char_new.events
    expect(evt2?.related_entry_id).toBeNull()
  })

  it('regenerates event ids, dropping the originals (profile v1 preserves source ids)', () => {
    const result = remapOkfDumpIds(buildDump(), 'char_new')
    const eventIds = result.entities.char_new.events.map((e) => e.id)
    expect(eventIds).not.toContain('evt_1')
    expect(eventIds).not.toContain('evt_2')
    expect(eventIds.every((id) => id.startsWith('evt_'))).toBe(true)
    expect(new Set(eventIds).size).toBe(2)
  })
})

describe('event id regeneration (profile v1)', () => {
  it('regenerates every event id with the evt_ prefix and drops the originals', () => {
    const dump = {
      generatedAt: 0,
      entities: {
        e1: {
          facts: [{ id: 'fact_a' }],
          tasks: [],
          edges: [],
          events: [
            { id: 'evt_original_1', related_entry_id: 'fact_a' },
            { id: 'evt_original_2', related_entry_id: null },
          ],
        },
      },
    } as never
    const result = remapOkfDumpIds(dump, 'e1')
    const events = result.entities.e1.events as Array<{ id: string; related_entry_id: string | null }>
    expect(events.map((e) => e.id)).not.toContain('evt_original_1')
    expect(events.map((e) => e.id)).not.toContain('evt_original_2')
    expect(events.every((e) => e.id.startsWith('evt_'))).toBe(true)
    expect(new Set(events.map((e) => e.id)).size).toBe(2)
    // related_entry_id still remaps through the fact id map
    const newFactId = (result.entities.e1.facts[0] as { id: string }).id
    expect(events[0].related_entry_id).toBe(newFactId)
    expect(events[1].related_entry_id).toBeNull()
  })
})

describe('clone against golden-v1 fixture', () => {
  it('leaves no fixture event id in the remapped dump (clone-beside-source regression)', () => {
    const dump = parseOkfBundle('cloneTarget', loadOkfFixture('golden-v1'))
    const sourceEventIds = dump.entities.cloneTarget.events.map((e) => e.id)
    expect(sourceEventIds).toEqual(expect.arrayContaining(['evt_golden_1', 'evt_golden_2']))
    const remapped = remapOkfDumpIds(dump, 'cloneTarget')
    const remappedIds = remapped.entities.cloneTarget.events.map((e) => e.id)
    expect(remappedIds).not.toEqual(expect.arrayContaining(['evt_golden_1']))
    expect(remappedIds).not.toEqual(expect.arrayContaining(['evt_golden_2']))
    expect(remapped.entities.cloneTarget.events).toHaveLength(sourceEventIds.length)
  })
})
