import { remapOkfDumpIds } from '../okfImportRemap'
import { randomUUID } from 'expo-crypto'
import type { MemoryDump } from '@equationalapplications/expo-llm-wiki'

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
    const result = remapOkfDumpIds(buildDump(), 'char_new')
    const entity = result.entities.char_new
    const [newFact1] = entity.facts
    const evt1 = entity.events.find((e) => e.id === 'evt_1')
    expect(evt1?.related_entry_id).toBe(newFact1.id)
  })

  it('leaves a null related_entry_id alone', () => {
    const result = remapOkfDumpIds(buildDump(), 'char_new')
    const evt2 = result.entities.char_new.events.find((e) => e.id === 'evt_2')
    expect(evt2?.related_entry_id).toBeNull()
  })

  it('does not remap event ids themselves', () => {
    const result = remapOkfDumpIds(buildDump(), 'char_new')
    expect(result.entities.char_new.events.map((e) => e.id)).toEqual(['evt_1', 'evt_2'])
  })
})
