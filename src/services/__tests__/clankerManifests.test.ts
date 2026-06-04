import { agentToolSpec, getSchemasForEdge } from '../../../shared/agent-tools-spec'

function findSpec(name: string) {
  return agentToolSpec.find(s => s.name === name)!
}

describe('get_current_time spec', () => {
  it('has name get_current_time', () => {
    expect(findSpec('get_current_time').name).toBe('get_current_time')
  })

  it('description contains CRITICAL', () => {
    expect(findSpec('get_current_time').description).toContain('CRITICAL')
  })

  it('description mentions today and tomorrow', () => {
    expect(findSpec('get_current_time').description).toContain('today')
    expect(findSpec('get_current_time').description).toContain('tomorrow')
  })
})

describe('escalate_to_cloud_agent spec', () => {
  it('has name escalate_to_cloud_agent', () => {
    expect(findSpec('escalate_to_cloud_agent').name).toBe('escalate_to_cloud_agent')
  })

  it('description says Do NOT use for reading memory', () => {
    expect(findSpec('escalate_to_cloud_agent').description).toContain('Do NOT')
    expect(findSpec('escalate_to_cloud_agent').description).toContain('reading memory')
  })
})

describe('wiki_read spec', () => {
  it('has name wiki_read', () => {
    expect(findSpec('wiki_read').name).toBe('wiki_read')
  })

  it('description says ALWAYS use for recall', () => {
    expect(findSpec('wiki_read').description).toContain('ALWAYS')
  })

  it('has required query parameter', () => {
    const spec = findSpec('wiki_read')
    expect(spec.parameters.required).toContain('query')
    expect(spec.parameters.properties['query']).toBeDefined()
  })
})

describe('wiki_write spec', () => {
  it('has name wiki_write', () => {
    expect(findSpec('wiki_write').name).toBe('wiki_write')
  })

  it('description mentions long-term memory', () => {
    expect(findSpec('wiki_write').description).toContain('long-term memory')
  })

  it('has required summary parameter of type string', () => {
    const spec = findSpec('wiki_write')
    expect(spec.parameters.required).toContain('summary')
    expect(spec.parameters.properties['summary'].type).toBe('string')
  })

  it('parameters type is object', () => {
    expect(findSpec('wiki_write').parameters.type).toBe('object')
  })
})

describe('escalate_to_cloud_agent — updated guard', () => {
  it('description forbids WRITING/saving observations', () => {
    expect(findSpec('escalate_to_cloud_agent').description).toContain('WRITING/saving observations')
  })
})

describe('create_task spec', () => {
  it('has name create_task', () => {
    expect(findSpec('create_task').name).toBe('create_task')
  })

  it('has required title parameter of type string', () => {
    const spec = findSpec('create_task')
    expect(spec.parameters.required).toContain('title')
    expect(spec.parameters.properties['title'].type).toBe('string')
  })

  it('parameters type is object', () => {
    expect(findSpec('create_task').parameters.type).toBe('object')
  })
})

describe('list_tasks spec', () => {
  it('has name list_tasks', () => {
    expect(findSpec('list_tasks').name).toBe('list_tasks')
  })

  it('parameters type is object', () => {
    expect(findSpec('list_tasks').parameters.type).toBe('object')
  })
})

describe('getSchemasForEdge', () => {
  it('includes wiki tools when hasWiki=true', () => {
    const schemas = getSchemasForEdge(true, true)
    const names = schemas.map(s => s.name)
    expect(names).toContain('wiki_read')
    expect(names).toContain('wiki_write')
  })

  it('excludes wiki tools when hasWiki=false', () => {
    const schemas = getSchemasForEdge(false, true)
    const names = schemas.map(s => s.name)
    expect(names).not.toContain('wiki_read')
    expect(names).not.toContain('wiki_write')
  })

  it('excludes escalate_to_cloud_agent when isCloudSynced=false', () => {
    const schemas = getSchemasForEdge(true, false)
    const names = schemas.map(s => s.name)
    expect(names).not.toContain('escalate_to_cloud_agent')
  })
})

describe('escalate_to_cloud_agent — task guard', () => {
  it('description forbids delegating task creation or listing', () => {
    expect(findSpec('escalate_to_cloud_agent').description).toMatch(/task/i)
  })
})
