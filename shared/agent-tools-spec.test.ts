import {
  agentToolSpec,
  getSchemasForEdge,
  getSchemasForCloud,
  isCloudOnlyToolName,
  isLocallyExecutableCloudTool,
} from './agent-tools-spec'

describe('agent-tools-spec', () => {
  it('includes wiki_get_ontology and wiki_traverse_graph as edge-only tools', () => {
    const ontologyTool = agentToolSpec.find((t) => t.name === 'wiki_get_ontology')
    const traverseTool = agentToolSpec.find((t) => t.name === 'wiki_traverse_graph')
    expect(ontologyTool?.tier).toBe('edge-only')
    expect(traverseTool?.tier).toBe('edge-only')
  })

  it('getSchemasForEdge includes the new graph tools regardless of wiki/cloud-sync flags', () => {
    for (const [hasWiki, isCloudSynced] of [
      [true, true],
      [true, false],
      [false, true],
      [false, false],
    ] as const) {
      const names = getSchemasForEdge(hasWiki, isCloudSynced).map((t) => t.name)
      expect(names).toContain('wiki_get_ontology')
      expect(names).toContain('wiki_traverse_graph')
    }
  })

  it('getSchemasForCloud does not include the edge-only graph tools', () => {
    const names = getSchemasForCloud().map((t) => t.name)
    expect(names).not.toContain('wiki_get_ontology')
    expect(names).not.toContain('wiki_traverse_graph')
  })

  it('wiki_traverse_graph requires sourceId', () => {
    const traverseTool = agentToolSpec.find((t) => t.name === 'wiki_traverse_graph')
    expect(traverseTool?.parameters.required).toEqual(['sourceId'])
  })
})

describe('image-generation escalation (edge has no generate_image tool)', () => {
  it('tells the edge model to escalate image requests', () => {
    const escalate = agentToolSpec.find((t) => t.name === 'escalate_to_cloud_agent')
    expect(escalate?.description).toMatch(/image/i)
  })
})

describe('cloud-only stub routing', () => {
  it('registers generate_image as a cloud-only tool', () => {
    const tool = agentToolSpec.find((t) => t.name === 'generate_image')
    expect(tool?.tier).toBe('cloud-only')
    expect(tool?.parameters.required).toEqual(['prompt'])
  })

  it('offers cloud-only tools to the edge agent as stubs when the character is cloud-synced', () => {
    const names = getSchemasForEdge(true, true).map((t) => t.name)
    expect(names).toContain('generate_image')
    expect(names).toContain('set_reminder')
  })

  it('hides non-executable cloud-only stubs when the character is not cloud-synced', () => {
    const names = getSchemasForEdge(true, false).map((t) => t.name)
    expect(names).not.toContain('set_reminder')
    expect(names).not.toContain('escalate_to_cloud_agent')
  })

  it('still offers generate_image without cloud sync — the edge runs it locally', () => {
    const names = getSchemasForEdge(true, false).map((t) => t.name)
    expect(names).toContain('generate_image')
  })

  it('flags generate_image as locally executable and set_reminder as not', () => {
    expect(isLocallyExecutableCloudTool('generate_image')).toBe(true)
    expect(isLocallyExecutableCloudTool('set_reminder')).toBe(false)
    expect(isLocallyExecutableCloudTool('wiki_read')).toBe(false)
  })

  it('still exposes cloud-only tools to the cloud agent', () => {
    expect(getSchemasForCloud().map((t) => t.name)).toContain('generate_image')
  })

  it('identifies cloud-only tool names for the escalation interceptor', () => {
    expect(isCloudOnlyToolName('generate_image')).toBe(true)
    expect(isCloudOnlyToolName('set_reminder')).toBe(true)
    expect(isCloudOnlyToolName('wiki_read')).toBe(false)
    expect(isCloudOnlyToolName('escalate_to_cloud_agent')).toBe(false)
  })
})
