import { augmentWithEdgeLinks } from '../augmentWithEdgeLinks'
import { parseOkfBundle, formatOkfBundle } from '@equationalapplications/expo-llm-wiki'

type OkfFile = ReturnType<typeof formatOkfBundle>['files'][number]

describe('augmentWithEdgeLinks', () => {
  it('extracts ids from concept file frontmatter', () => {
    const files: OkfFile[] = [
      {
        path: 'entities/char_1/facts/fact_abc.md',
        content: `---
type: fact
id: fact_abc
title: "Test"
---
Body text`,
      },
    ]

    const result = augmentWithEdgeLinks(files, [])
    expect(result[0].content).toContain('Body text')
  })

  it('does not extract ids from the markdown body', () => {
    const files: OkfFile[] = [
      {
        path: 'entities/char_1/facts/fact_abc.md',
        content: `---
type: fact
title: "Source without id"
---
Example YAML:
id: fact_abc`,
      },
      {
        path: 'entities/char_1/facts/fact_xyz.md',
        content: `---
type: fact
id: fact_xyz
title: "Target"
---
Body B`,
      },
    ]

    const edges = [
      {
        id: 'edge_1',
        entity_id: 'char_1',
        source_id: 'fact_abc',
        target_id: 'fact_xyz',
        edge_type: 'related_to',
        created_at: 1234567890,
      },
    ]

    const result = augmentWithEdgeLinks(files, edges)
    expect(result[0].content).not.toContain('## Related')
  })

  it('appends same-type links (fact to fact)', () => {
    const files: OkfFile[] = [
      {
        path: 'entities/char_1/facts/fact_abc.md',
        content: `---
type: fact
id: fact_abc
title: "Fact A"
---
Body A`,
      },
      {
        path: 'entities/char_1/facts/fact_xyz.md',
        content: `---
type: fact
id: fact_xyz
title: "Fact B"
---
Body B`,
      },
    ]

    const edges = [
      {
        id: 'edge_1',
        entity_id: 'char_1',
        source_id: 'fact_abc',
        target_id: 'fact_xyz',
        edge_type: 'related_to',
        created_at: 1234567890,
      },
    ]

    const result = augmentWithEdgeLinks(files, edges)
    const augmented = result.find((f) => f.path.includes('fact_abc.md'))
    expect(augmented?.content).toContain('## Related')
    expect(augmented?.content).toContain('[related_to](./fact_xyz.md)')
  })

  it('appends cross-type links (fact to task)', () => {
    const files: OkfFile[] = [
      {
        path: 'entities/char_1/facts/fact_abc.md',
        content: `---
type: fact
id: fact_abc
title: "Fact"
---
Fact body`,
      },
      {
        path: 'entities/char_1/tasks/task_xyz.md',
        content: `---
type: task
id: task_xyz
title: "Task"
---`,
      },
    ]

    const edges = [
      {
        id: 'edge_1',
        entity_id: 'char_1',
        source_id: 'fact_abc',
        target_id: 'task_xyz',
        edge_type: 'prerequisite_for',
        created_at: 1234567890,
      },
    ]

    const result = augmentWithEdgeLinks(files, edges)
    const augmented = result.find((f) => f.path.includes('fact_abc.md'))
    expect(augmented?.content).toContain('[prerequisite_for](../tasks/task_xyz.md)')
  })

  it('skips dangling edges (target not in bundle)', () => {
    const files: OkfFile[] = [
      {
        path: 'entities/char_1/facts/fact_abc.md',
        content: `---
type: fact
id: fact_abc
title: "Fact"
---
Body`,
      },
    ]

    const edges = [
      {
        id: 'edge_1',
        entity_id: 'char_1',
        source_id: 'fact_abc',
        target_id: 'missing_target',
        edge_type: 'links_to',
        created_at: 1234567890,
      },
    ]

    const result = augmentWithEdgeLinks(files, edges)
    const augmented = result.find((f) => f.path.includes('fact_abc.md'))
    expect(augmented?.content).not.toContain('## Related')
  })

  it('handles multiple outgoing edges from same source', () => {
    const files: OkfFile[] = [
      {
        path: 'entities/char_1/facts/fact_abc.md',
        content: `---
type: fact
id: fact_abc
title: "Fact"
---
Body`,
      },
      {
        path: 'entities/char_1/facts/fact_1.md',
        content: `---
type: fact
id: fact_1
title: "Related 1"
---`,
      },
      {
        path: 'entities/char_1/facts/fact_2.md',
        content: `---
type: fact
id: fact_2
title: "Related 2"
---`,
      },
    ]

    const edges = [
      {
        id: 'edge_1',
        entity_id: 'char_1',
        source_id: 'fact_abc',
        target_id: 'fact_1',
        edge_type: 'related_to',
        created_at: 1234567890,
      },
      {
        id: 'edge_2',
        entity_id: 'char_1',
        source_id: 'fact_abc',
        target_id: 'fact_2',
        edge_type: 'related_to',
        created_at: 1234567891,
      },
    ]

    const result = augmentWithEdgeLinks(files, edges)
    const augmented = result.find((f) => f.path.includes('fact_abc.md'))
    expect(augmented?.content).toContain('[related_to](./fact_1.md)')
    expect(augmented?.content).toContain('[related_to](./fact_2.md)')
  })

  it('does not duplicate the Related section on multiple calls', () => {
    const files: OkfFile[] = [
      {
        path: 'entities/char_1/facts/fact_abc.md',
        content: `---
type: fact
id: fact_abc
title: "Fact"
---
Body`,
      },
      {
        path: 'entities/char_1/facts/fact_xyz.md',
        content: `---
type: fact
id: fact_xyz
title: "Target"
---`,
      },
    ]

    const edges = [
      {
        id: 'edge_1',
        entity_id: 'char_1',
        source_id: 'fact_abc',
        target_id: 'fact_xyz',
        edge_type: 'related_to',
        created_at: 1234567890,
      },
    ]

    const firstPass = augmentWithEdgeLinks(files, edges)
    const secondPass = augmentWithEdgeLinks(firstPass, edges)

    const countRelated = (content: string) => (content.match(/## Related/g) || []).length
    expect(countRelated(secondPass[0].content)).toBe(1)
  })

  it('round-trips through parseOkfBundle: augmented links reconstruct as edges', () => {
    const files: OkfFile[] = [
      {
        path: 'entities/char_1/facts/fact_abc.md',
        content: `---
type: fact
id: fact_abc
title: "Fact A"
---
Body A`,
      },
      {
        path: 'entities/char_1/facts/fact_xyz.md',
        content: `---
type: fact
id: fact_xyz
title: "Fact B"
---
Body B`,
      },
    ]

    const edges = [
      {
        id: 'edge_1',
        entity_id: 'char_1',
        source_id: 'fact_abc',
        target_id: 'fact_xyz',
        edge_type: 'related_to',
        created_at: 1234567890,
      },
    ]

    const augmented = augmentWithEdgeLinks(files, edges)
    const reparsed = parseOkfBundle('char_1', augmented)

    expect(reparsed.entities.char_1.edges).toHaveLength(1)
    expect(reparsed.entities.char_1.edges?.[0]).toMatchObject({
      source_id: 'fact_abc',
      target_id: 'fact_xyz',
      edge_type: 'related_to',
    })
  })
})
