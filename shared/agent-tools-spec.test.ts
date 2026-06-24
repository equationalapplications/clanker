import { agentToolSpec, getSchemasForEdge, getSchemasForCloud } from './agent-tools-spec'

describe('agent-tools-spec', () => {
  it('includes wiki_get_ontology and wiki_traverse_graph as edge-only tools', () => {
    const ontologyTool = agentToolSpec.find((t) => t.name === 'wiki_get_ontology')
    const traverseTool = agentToolSpec.find((t) => t.name === 'wiki_traverse_graph')
    expect(ontologyTool?.tier).toBe('edge-only')
    expect(traverseTool?.tier).toBe('edge-only')
  })

  it('getSchemasForEdge includes the new graph tools regardless of wiki/cloud-sync flags', () => {
    for (const [hasWiki, isCloudSynced] of [[true, true], [true, false], [false, true], [false, false]] as const) {
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
