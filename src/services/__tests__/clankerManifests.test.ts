import { clankerTimeSchema, clankerEscalationSchema, clankerMemorySchema, clankerWriteObservationSchema } from '../clankerManifests'

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

describe('clankerWriteObservationSchema', () => {
  it('has name write_observation', () => {
    expect(clankerWriteObservationSchema.name).toBe('write_observation')
  })

  it('description mentions long-term memory', () => {
    expect(clankerWriteObservationSchema.description).toContain('long-term memory')
  })

  it('has required summary parameter of type string', () => {
    const params = clankerWriteObservationSchema.parameters as {
      required: string[]
      properties: Record<string, { type: string }>
    }
    expect(params.required).toContain('summary')
    expect(params.properties['summary'].type).toBe('string')
  })

  it('parameters type is object', () => {
    expect(clankerWriteObservationSchema.parameters.type).toBe('object')
  })
})

describe('clankerEscalationSchema — updated guard', () => {
  it('description forbids WRITING/saving observations', () => {
    expect(clankerEscalationSchema.description).toContain('WRITING/saving observations')
  })
})
