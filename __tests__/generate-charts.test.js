const { queryFileEdges, renderFileChart, toDocFilename } = require('../scripts/generate-charts')

describe('queryFileEdges', () => {
  it('scopes query to directory and returns deduplicated file-to-file edges', () => {
    const mockRows = [
      { src_path: 'src/services/aiChatService.ts', tgt_path: 'src/hooks/useChat.ts' },
      { src_path: 'src/services/aiChatService.ts', tgt_path: 'src/hooks/useChat.ts' },
      { src_path: 'src/services/tokenService.ts', tgt_path: 'src/database/tokens.ts' },
    ]
    let capturedParam
    const mockDb = {
      prepare: () => ({ all: (param) => { capturedParam = param; return mockRows } }),
    }
    const result = queryFileEdges(mockDb, 'services')
    expect(capturedParam).toBe('src/services/%')
    expect(result).toHaveLength(2)
    expect(result).toContainEqual({ sourceFile: 'aiChatService', targetFile: 'useChat' })
    expect(result).toContainEqual({ sourceFile: 'tokenService', targetFile: 'tokens' })
  })

  it('excludes self-referential edges', () => {
    const mockRows = [
      { src_path: 'src/hooks/useChat.ts', tgt_path: 'src/hooks/useChat.ts' },
    ]
    const mockDb = {
      prepare: () => ({ all: () => mockRows }),
    }
    expect(queryFileEdges(mockDb, 'hooks')).toHaveLength(0)
  })

  it('restricts call targets to src/', () => {
    let capturedSql
    const mockDb = {
      prepare: (sql) => {
        capturedSql = sql
        return { all: () => [] }
      },
    }
    queryFileEdges(mockDb, 'hooks')
    expect(capturedSql).toContain("nt.file_path LIKE 'src/%'")
  })
})

describe('renderFileChart', () => {
  it('renders a graph LR block with file-level edges', () => {
    const edges = [
      { sourceFile: 'aiChatService', targetFile: 'useChat' },
      { sourceFile: 'tokenService', targetFile: 'tokens' },
    ]
    const result = renderFileChart('services', edges)
    expect(result).toContain('# services')
    expect(result).toContain('graph LR')
    expect(result).toContain('  aiChatService --> useChat')
    expect(result).toContain('  tokenService --> tokens')
    expect(result).toContain('npm run docs:charts')
  })

  it('returns empty notice when no edges present', () => {
    const result = renderFileChart('hooks', [])
    expect(result).toContain('_No edges found')
    expect(result).not.toContain('graph LR')
  })
})

describe('toDocFilename', () => {
  it('converts directory names to SCREAMING_SNAKE_CASE markdown filenames', () => {
    expect(toDocFilename('hooks')).toBe('HOOKS.md')
    expect(toDocFilename('components')).toBe('COMPONENTS.md')
  })
})
