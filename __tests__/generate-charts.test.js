const {
  sanitizeName,
  makeNodeId,
  makeNodeLabel,
  buildEdgeSet,
  renderMermaid,
} = require('../scripts/generate-charts')

describe('sanitizeName', () => {
  it('replaces non-alphanumeric chars with underscore', () => {
    expect(sanitizeName('foo-bar.ts')).toBe('foo_bar_ts')
  })
  it('leaves clean names unchanged', () => {
    expect(sanitizeName('fooBar')).toBe('fooBar')
  })
  it('prefixes digit-leading names with underscore', () => {
    expect(sanitizeName('123abc')).toBe('_123abc')
  })
})

describe('makeNodeId', () => {
  it('combines sanitized name and file', () => {
    expect(makeNodeId('getDatabase', 'src/database/index.ts')).toBe('getDatabase__src_database_index_ts')
  })
})

describe('makeNodeLabel', () => {
  it('returns name and basename', () => {
    expect(makeNodeLabel('getDatabase', 'src/database/index.ts')).toBe('getDatabase\n(index.ts)')
  })
  it('escapes double-quotes in name', () => {
    expect(makeNodeLabel('get"Value', 'src/x.ts')).toBe("get'Value\n(x.ts)")
  })
})

describe('buildEdgeSet', () => {
  it('collects direct call edges', () => {
    const rows = [
      { source_name: 'a', source_file: 'src/x.ts', target_name: 'b', target_file: 'src/y.ts' },
    ]
    const edges = buildEdgeSet(rows)
    expect(edges).toEqual([
      {
        sourceId: 'a__src_x_ts',
        sourceLabel: 'a\n(x.ts)',
        targetId: 'b__src_y_ts',
        targetLabel: 'b\n(y.ts)',
      },
    ])
  })
  it('deduplicates identical edges', () => {
    const row = { source_name: 'a', source_file: 'src/x.ts', target_name: 'b', target_file: 'src/y.ts' }
    const edges = buildEdgeSet([row, row])
    expect(edges).toHaveLength(1)
  })
})

describe('renderMermaid', () => {
  it('wraps edges in graph TD block', () => {
    const edges = [
      { sourceId: 'a_x', sourceLabel: 'a\n(x.ts)', targetId: 'b_y', targetLabel: 'b\n(y.ts)' },
    ]
    const result = renderMermaid('database', edges)
    expect(result).toContain('# database call graph')
    expect(result).toContain('graph TD')
    expect(result).toContain('a_x["a\n(x.ts)"] --> b_y["b\n(y.ts)"]')
  })
  it('returns empty-graph notice when no edges', () => {
    const result = renderMermaid('machines', [])
    expect(result).toContain('_No call edges found')
  })
})
