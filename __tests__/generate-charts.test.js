const {
  queryFolderEdges,
  renderFolderOverview,
} = require('../scripts/generate-charts')

describe('queryFolderEdges', () => {
  it('passes the query to db.prepare().all() and returns results', () => {
    const mockRows = [
      { s_dir: 'hooks', t_dir: 'services' },
      { s_dir: 'components', t_dir: 'hooks' },
    ]
    const mockDb = {
      prepare: () => ({ all: () => mockRows }),
    }
    expect(queryFolderEdges(mockDb)).toEqual(mockRows)
  })
})

describe('renderFolderOverview', () => {
  it('renders a graph LR block with folder edges', () => {
    const edges = [
      { s_dir: 'hooks', t_dir: 'services' },
      { s_dir: 'components', t_dir: 'hooks' },
    ]
    const result = renderFolderOverview(edges)
    expect(result).toContain('# Source folder dependencies')
    expect(result).toContain('graph LR')
    expect(result).toContain('  hooks --> services')
    expect(result).toContain('  components --> hooks')
    expect(result).toContain('npm run docs:charts')
  })

  it('returns empty notice when no edges present', () => {
    const result = renderFolderOverview([])
    expect(result).toContain('_No folder-level edges found._')
    expect(result).not.toContain('graph LR')
  })
})
