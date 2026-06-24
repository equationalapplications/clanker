import { edgeToolExecutors, createEdgeToolExecutors } from '../edgeToolExecutors'
import { readFromWiki, writeToWiki } from '../wikiService'
import { createTask, listTasks, updateTask, completeTask, deleteTask } from '../../database/taskDatabase'
import type { LocalTask } from '../../database/taskDatabase'
import { formatGraphContext } from '@equationalapplications/core-llm-wiki'

jest.mock('../wikiService', () => ({
  readFromWiki: jest.fn(),
  writeToWiki: jest.fn(),
}))

jest.mock('../../database/taskDatabase', () => ({
  createTask: jest.fn(),
  listTasks: jest.fn(),
  updateTask: jest.fn(),
  completeTask: jest.fn(),
  deleteTask: jest.fn(),
}))

jest.mock('@equationalapplications/core-llm-wiki', () => ({
  formatGraphContext: jest.fn(() => 'formatted graph context'),
}))

const mockReadFromWiki = readFromWiki as jest.Mock
const mockWriteToWiki = writeToWiki as jest.Mock
const mockCreateTask = createTask as jest.Mock
const mockListTasks = listTasks as jest.Mock
const mockUpdateTask = updateTask as jest.Mock
const mockCompleteTask = completeTask as jest.Mock
const mockDeleteTask = deleteTask as jest.Mock
const mockFormatGraphContext = formatGraphContext as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe('edgeToolExecutors (static map)', () => {
  it('get_current_time is present and returns a string containing a year', () => {
    expect(typeof edgeToolExecutors['get_current_time']).toBe('function')
    const result = edgeToolExecutors['get_current_time']({}) as string
    expect(result).toMatch(/\d{4}/)
  })
})

describe('createEdgeToolExecutors — wiki_read', () => {
  it('returns "No relevant memories found." when wiki is null', async () => {
    const execs = createEdgeToolExecutors('char-1', null)
    const result = await execs['wiki_read']({ query: 'anything' })
    expect(result).toBe('No relevant memories found.')
    expect(mockReadFromWiki).not.toHaveBeenCalled()
  })

  it('returns JSON string when wiki returns facts', async () => {
    const mockResults = { facts: [{ content: 'User likes coffee' }], tasks: [], events: [] }
    mockReadFromWiki.mockResolvedValue(mockResults)
    const wiki = {} as any
    const execs = createEdgeToolExecutors('char-1', wiki)
    const result = await execs['wiki_read']({ query: 'coffee' })
    expect(result).toBe(JSON.stringify(mockResults))
  })

  it('returns "No relevant memories found." when readFromWiki throws', async () => {
    mockReadFromWiki.mockRejectedValue(new Error('SQLite locked'))
    const wiki = {} as any
    const execs = createEdgeToolExecutors('char-1', wiki)
    const result = await execs['wiki_read']({ query: 'coffee' })
    expect(result).toBe('No relevant memories found.')
  })
})

describe('createEdgeToolExecutors — wiki_write', () => {
  it('returns failure message when wiki is null', async () => {
    const execs = createEdgeToolExecutors('char-1', null)
    const result = await execs['wiki_write']({ summary: 'User likes tea' })
    expect(result).toBe('Failed to record observation: Invalid input or missing database.')
    expect(mockWriteToWiki).not.toHaveBeenCalled()
  })

  it('calls writeToWiki and returns success message', async () => {
    mockWriteToWiki.mockResolvedValue(undefined)
    const wiki = {} as any
    const execs = createEdgeToolExecutors('char-42', wiki)
    const result = await execs['wiki_write']({ summary: 'User prefers dark mode' })
    expect(mockWriteToWiki).toHaveBeenCalledWith(wiki, 'char-42', {
      event_type: 'observation',
      summary: 'User prefers dark mode',
    })
    expect(result).toBe('Observation recorded successfully.')
  })

  it('returns internal error message when writeToWiki throws', async () => {
    mockWriteToWiki.mockRejectedValue(new Error('SQLite locked'))
    const wiki = {} as any
    const execs = createEdgeToolExecutors('char-1', wiki)
    const result = await execs['wiki_write']({ summary: 'User likes jazz' })
    expect(result).toBe('Failed to record observation due to an internal error.')
  })
})

describe('createEdgeToolExecutors — create_task / list_tasks', () => {
  it('create_task returns failure message when title is missing', async () => {
    const execs = createEdgeToolExecutors('char-1', null)
    const result = await execs['create_task']({})
    expect(result).toBe('Failed to create task: title is required.')
    expect(mockCreateTask).not.toHaveBeenCalled()
  })

  it('create_task returns JSON with taskId on success', async () => {
    mockCreateTask.mockResolvedValue('task_123')
    const execs = createEdgeToolExecutors('char-1', null)
    const result = await execs['create_task']({ title: 'Buy milk' })
    expect(result).toBe(JSON.stringify({ taskId: 'task_123', title: 'Buy milk' }))
  })

  it('list_tasks returns "No tasks found." when list is empty', async () => {
    mockListTasks.mockResolvedValue([])
    const execs = createEdgeToolExecutors('char-1', null)
    const result = await execs['list_tasks']({})
    expect(result).toBe('No tasks found.')
  })

  it('list_tasks returns JSON with open tasks', async () => {
    const tasks: LocalTask[] = [
      { id: 'task_1', character_id: 'char-1', title: 'Buy milk', status: 'pending', created_at: 1000 },
    ]
    mockListTasks.mockResolvedValue(tasks)
    const execs = createEdgeToolExecutors('char-1', null)
    const result = await execs['list_tasks']({})
    const parsed = JSON.parse(result as string)
    expect(parsed[0]).toEqual({ id: 'task_1', title: 'Buy milk', status: 'open' })
  })
})

describe('createEdgeToolExecutors — update_task / complete_task / delete_task', () => {
  it('update_task requires taskId and title', async () => {
    const execs = createEdgeToolExecutors('char-1', null)
    const result = await execs['update_task']({ taskId: 'x' })
    expect(result).toBe('Failed to update task: taskId and title are required.')
    expect(mockUpdateTask).not.toHaveBeenCalled()
  })

  it('update_task calls updateTask and returns confirmation', async () => {
    mockUpdateTask.mockResolvedValue(undefined)
    const execs = createEdgeToolExecutors('char-1', null)
    const result = await execs['update_task']({ taskId: 'task_1', title: 'Buy oat milk' })
    expect(mockUpdateTask).toHaveBeenCalledWith('char-1', 'task_1', 'Buy oat milk')
    expect(result).toBe('Task updated.')
  })

  it('complete_task requires taskId', async () => {
    const execs = createEdgeToolExecutors('char-1', null)
    const result = await execs['complete_task']({})
    expect(result).toBe('Failed to complete task: taskId is required.')
    expect(mockCompleteTask).not.toHaveBeenCalled()
  })

  it('complete_task calls completeTask and returns confirmation', async () => {
    mockCompleteTask.mockResolvedValue(undefined)
    const execs = createEdgeToolExecutors('char-1', null)
    const result = await execs['complete_task']({ taskId: 'task_1' })
    expect(mockCompleteTask).toHaveBeenCalledWith('char-1', 'task_1')
    expect(result).toBe('Task marked as completed.')
  })

  it('delete_task requires taskId', async () => {
    const execs = createEdgeToolExecutors('char-1', null)
    const result = await execs['delete_task']({})
    expect(result).toBe('Failed to delete task: taskId is required.')
    expect(mockDeleteTask).not.toHaveBeenCalled()
  })

  it('delete_task calls deleteTask and returns confirmation', async () => {
    mockDeleteTask.mockResolvedValue(undefined)
    const execs = createEdgeToolExecutors('char-1', null)
    const result = await execs['delete_task']({ taskId: 'task_1' })
    expect(mockDeleteTask).toHaveBeenCalledWith('char-1', 'task_1')
    expect(result).toBe('Task deleted.')
  })
})

describe('createEdgeToolExecutors — document_search (placeholder)', () => {
  it('returns the not-yet-available placeholder message', async () => {
    const execs = createEdgeToolExecutors('char-1', null)
    const result = await execs['document_search']({ query: 'invoice' })
    expect(result).toBe('Document search is not yet available on device.')
  })
})

describe('createEdgeToolExecutors — set_reminder (escalation phantom tool)', () => {
  it('returns the ESCALATE_TO_CLOUD_AGENT sentinel', async () => {
    const execs = createEdgeToolExecutors('char-1', null)
    const result = await execs['set_reminder']({})
    expect(result).toBe('ESCALATE_TO_CLOUD_AGENT')
  })
})

describe('createEdgeToolExecutors — wiki_get_ontology', () => {
  it('returns { mode: "off", manifest: null } when wiki is null', async () => {
    const execs = createEdgeToolExecutors('char-1', null)
    const result = await execs['wiki_get_ontology']({})
    expect(result).toBe(JSON.stringify({ mode: 'off', manifest: null }))
  })

  it('returns the resolved manifest when wiki has one', async () => {
    const manifest = { mode: 'emergent', manifest: { node_types: [], edge_types: [] } }
    const wiki = { getOntologyManifest: jest.fn().mockResolvedValue(manifest) } as any
    const execs = createEdgeToolExecutors('char-1', wiki)
    const result = await execs['wiki_get_ontology']({})
    expect(wiki.getOntologyManifest).toHaveBeenCalledWith('char-1')
    expect(result).toBe(JSON.stringify(manifest))
  })

  it('returns { mode: "off", manifest: null } when wiki has no manifest', async () => {
    const wiki = { getOntologyManifest: jest.fn().mockResolvedValue(null) } as any
    const execs = createEdgeToolExecutors('char-1', wiki)
    const result = await execs['wiki_get_ontology']({})
    expect(result).toBe(JSON.stringify({ mode: 'off', manifest: null }))
  })

  it('returns the off fallback when getOntologyManifest throws', async () => {
    const wiki = { getOntologyManifest: jest.fn().mockRejectedValue(new Error('locked')) } as any
    const execs = createEdgeToolExecutors('char-1', wiki)
    const result = await execs['wiki_get_ontology']({})
    expect(result).toBe(JSON.stringify({ mode: 'off', manifest: null }))
  })
})

describe('createEdgeToolExecutors — wiki_traverse_graph', () => {
  it('requires sourceId', async () => {
    const wiki = { traverseGraph: jest.fn() } as any
    const execs = createEdgeToolExecutors('char-1', wiki)
    const result = await execs['wiki_traverse_graph']({})
    expect(result).toBe('Failed to traverse graph: sourceId is required.')
    expect(wiki.traverseGraph).not.toHaveBeenCalled()
  })

  it('returns a failure message when wiki is null', async () => {
    const execs = createEdgeToolExecutors('char-1', null)
    const result = await execs['wiki_traverse_graph']({ sourceId: 'fact-1' })
    expect(result).toBe('Failed to traverse graph: sourceId is required.')
  })

  it('calls wiki.traverseGraph with parsed options and formats the result', async () => {
    const neighborhood = { nodes: [], edges: [] }
    const wiki = { traverseGraph: jest.fn().mockResolvedValue(neighborhood) } as any
    const execs = createEdgeToolExecutors('char-1', wiki)
    const result = await execs['wiki_traverse_graph']({
      sourceId: 'fact-1',
      maxDepth: 2,
      direction: 'outbound',
      edgeTypes: ['relates_to'],
    })
    expect(wiki.traverseGraph).toHaveBeenCalledWith('char-1', {
      sourceId: 'fact-1',
      maxDepth: 2,
      direction: 'outbound',
      edgeTypes: ['relates_to'],
    })
    expect(mockFormatGraphContext).toHaveBeenCalledWith(neighborhood)
    expect(result).toBe('formatted graph context')
  })

  it('returns an internal-error message when wiki.traverseGraph throws', async () => {
    const wiki = { traverseGraph: jest.fn().mockRejectedValue(new Error('busy')) } as any
    const execs = createEdgeToolExecutors('char-1', wiki)
    const result = await execs['wiki_traverse_graph']({ sourceId: 'fact-1' })
    expect(result).toBe('Failed to traverse graph due to an internal error.')
  })
})
