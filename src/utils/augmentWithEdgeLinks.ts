import type { WikiEdge, formatOkfBundle } from '@equationalapplications/expo-llm-wiki'

type OkfFile = ReturnType<typeof formatOkfBundle>['files'][number]
type ConceptFolder = 'facts' | 'tasks'

const AUGMENTATION_MARKER = '<!-- okf-edges-augmented -->'

function isConceptFile(path: string): boolean {
  return (
    path.endsWith('.md') &&
    !path.endsWith('/index.md') &&
    !path.endsWith('/log.md') &&
    path !== 'index.md' &&
    path !== 'log.md'
  )
}

function getConceptFolder(path: string): ConceptFolder | null {
  if (path.includes('/facts/')) return 'facts'
  if (path.includes('/tasks/')) return 'tasks'
  return null
}

function filename(path: string): string {
  return path.split('/').pop() ?? path
}

function buildRelativeLink(sourcePath: string, targetPath: string): string | null {
  const sourceFolder = getConceptFolder(sourcePath)
  const targetFolder = getConceptFolder(targetPath)
  if (!sourceFolder || !targetFolder) return null

  if (sourceFolder === targetFolder) {
    return `./${filename(targetPath)}`
  }

  return `../${targetFolder}/${filename(targetPath)}`
}

function extractFrontmatterId(content: string): string | null {
  if (!content.startsWith('---\n')) return null
  const match = content.match(/^---\n[\s\S]*?\nid:\s*["']?([^"'\s]+)["']?/)
  return match?.[1] ?? null
}

export function augmentWithEdgeLinks(files: OkfFile[], edges: WikiEdge[]): OkfFile[] {
  if (edges.length === 0) return files

  const idToPath = new Map<string, string>()
  const pathToId = new Map<string, string>()

  for (const file of files) {
    if (!isConceptFile(file.path)) continue

    const id = extractFrontmatterId(file.content)
    if (!id) continue

    idToPath.set(id, file.path)
    pathToId.set(file.path, id)
  }

  const edgesBySource = new Map<string, WikiEdge[]>()
  for (const edge of edges) {
    const sourceEdges = edgesBySource.get(edge.source_id) ?? []
    sourceEdges.push(edge)
    edgesBySource.set(edge.source_id, sourceEdges)
  }

  return files.map((file) => {
    const sourceId = pathToId.get(file.path)
    if (!sourceId || file.content.includes(AUGMENTATION_MARKER)) return file

    const sourceEdges = edgesBySource.get(sourceId) ?? []
    if (sourceEdges.length === 0) return file

    const links = sourceEdges.flatMap((edge) => {
      const targetPath = idToPath.get(edge.target_id)
      if (!targetPath) {
        console.warn(`Dangling OKF edge skipped: ${edge.source_id} -> ${edge.target_id}`)
        return []
      }

      const relativeLink = buildRelativeLink(file.path, targetPath)
      return relativeLink ? [`- [${edge.edge_type}](${relativeLink})`] : []
    })

    if (links.length === 0) return file

    return {
      ...file,
      content: `${file.content}\n${AUGMENTATION_MARKER}\n## Related\n\n${links.join('\n')}`,
    }
  })
}
