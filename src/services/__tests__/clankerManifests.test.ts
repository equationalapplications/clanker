import { clankerTimeSchema, clankerEscalationSchema, clankerMemorySchema } from '../clankerManifests'

describe('clankerTimeSchema', () => {
  it('has name get_current_time', () => {
    expect(clankerTimeSchema.name).toBe('get_current_time')
  })

  it('description contains CRITICAL', () => {
    expect(clankerTimeSchema.description).toContain('CRITICAL')
  })

  it('description mentions today and tomorrow', () => {
    expect(clankerTimeSchema.description).toContain('today')
    expect(clankerTimeSchema.description).toContain('tomorrow')
  })
})

describe('clankerEscalationSchema', () => {
  it('has name escalate_to_cloud_agent', () => {
    expect(clankerEscalationSchema.name).toBe('escalate_to_cloud_agent')
  })

  it('description says Do NOT use for reading memory', () => {
    expect(clankerEscalationSchema.description).toContain('Do NOT')
    expect(clankerEscalationSchema.description).toContain('reading memory')
  })
})

describe('clankerMemorySchema', () => {
  it('has name search_memory', () => {
    expect(clankerMemorySchema.name).toBe('search_memory')
  })

  it('description says ALWAYS use for recall', () => {
    expect(clankerMemorySchema.description).toContain('ALWAYS')
  })

  it('has required query parameter', () => {
    const params = clankerMemorySchema.parameters as {
      required: string[]
      properties: Record<string, unknown>
    }
    expect(params.required).toContain('query')
    expect(params.properties['query']).toBeDefined()
  })
})
