import { edgeToolExecutors, createEdgeToolExecutors } from '../edgeToolExecutors'
import { readFromWiki, writeToWiki } from '../wikiService'
import { createTask, listTasks } from '../../database/taskDatabase'
import type { LocalTask } from '../../database/taskDatabase'

jest.mock('../wikiService', () => ({
  readFromWiki: jest.fn(),
  writeToWiki: jest.fn(),
}))

jest.mock('../../database/taskDatabase', () => ({
  createTask: jest.fn(),
  listTasks: jest.fn(),
}))

const mockReadFromWiki = readFromWiki as jest.Mock
const mockWriteToWiki = writeToWiki as jest.Mock
const mockCreateTask = createTask as jest.Mock
const mockListTasks = listTasks as jest.Mock

describe('edgeToolExecutors (static map)', () => {
  describe('get_current_time', () => {
    it('is present in the executor map', () => {
      expect(typeof edgeToolExecutors['get_current_time']).toBe('function')
    })

    it('returns a non-empty string', () => {
      const result = edgeToolExecutors['get_current_time']({})
      expect(typeof result).toBe('string')
      expect((result as string).length).toBeGreaterThan(0)
    })

    it('output contains a year (4-digit number)', () => {
      const result = edgeToolExecutors['get_current_time']({}) as string
      expect(result).toMatch(/\d{4}/)
    })
  })

  it('escalate_to_cloud is NOT in the executor map', () => {
    expect(edgeToolExecutors['escalate_to_cloud']).toBeUndefined()
  })

  it('search_memory is NOT in the static executor map', () => {
    expect(edgeToolExecutors['search_memory']).toBeUndefined()
  })
})

describe('createEdgeToolExecutors', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('includes get_current_time from static map', () => {
    const execs = createEdgeToolExecutors('char-1', null)
    expect(typeof execs['get_current_time']).toBe('function')
  })

  it('includes search_memory', () => {
    const execs = createEdgeToolExecutors('char-1', null)
    expect(typeof execs['search_memory']).toBe('function')
  })

  describe('search_memory', () => {
    it('returns "No relevant memories found." when wiki is null', async () => {
      const execs = createEdgeToolExecutors('char-1', null)
      const result = await execs['search_memory']({ query: 'anything' })
      expect(result).toBe('No relevant memories found.')
      expect(mockReadFromWiki).not.toHaveBeenCalled()
    })

    it('returns "No relevant memories found." when query is empty string', async () => {
      const wiki = {} as any
      const execs = createEdgeToolExecutors('char-1', wiki)
      const result = await execs['search_memory']({ query: '' })
      expect(result).toBe('No relevant memories found.')
      expect(mockReadFromWiki).not.toHaveBeenCalled()
    })

    it('returns "No relevant memories found." when wiki returns all empty arrays', async () => {
      mockReadFromWiki.mockResolvedValue({ facts: [], tasks: [], events: [] })
      const wiki = {} as any
      const execs = createEdgeToolExecutors('char-1', wiki)
      const result = await execs['search_memory']({ query: 'coffee' })
      expect(result).toBe('No relevant memories found.')
    })

    it('returns JSON string when wiki returns facts', async () => {
      const mockResults = { facts: [{ content: 'User likes coffee' }], tasks: [], events: [] }
      mockReadFromWiki.mockResolvedValue(mockResults)
      const wiki = {} as any
      const execs = createEdgeToolExecutors('char-1', wiki)
      const result = await execs['search_memory']({ query: 'coffee' })
      expect(result).toBe(JSON.stringify(mockResults))
    })

    it('returns JSON string when wiki returns tasks', async () => {
      const mockResults = { facts: [], tasks: [{ content: 'Buy groceries' }], events: [] }
      mockReadFromWiki.mockResolvedValue(mockResults)
      const wiki = {} as any
      const execs = createEdgeToolExecutors('char-1', wiki)
      const result = await execs['search_memory']({ query: 'groceries' })
      expect(result).toBe(JSON.stringify(mockResults))
    })

    it('returns JSON string when wiki returns events', async () => {
      const mockResults = { facts: [], tasks: [], events: [{ content: 'Met at park' }] }
      mockReadFromWiki.mockResolvedValue(mockResults)
      const wiki = {} as any
      const execs = createEdgeToolExecutors('char-1', wiki)
      const result = await execs['search_memory']({ query: 'park' })
      expect(result).toBe(JSON.stringify(mockResults))
    })

    it('calls readFromWiki with correct characterId and query', async () => {
      mockReadFromWiki.mockResolvedValue({ facts: [], tasks: [], events: [] })
      const wiki = {} as any
      const execs = createEdgeToolExecutors('char-42', wiki)
      await execs['search_memory']({ query: 'favorite food' })
      expect(mockReadFromWiki).toHaveBeenCalledWith(wiki, 'char-42', 'favorite food')
    })

    it('does not call readFromWiki when query is missing from args', async () => {
      const wiki = {} as any
      const execs = createEdgeToolExecutors('char-1', wiki)
      const result = await execs['search_memory']({})
      expect(result).toBe('No relevant memories found.')
      expect(mockReadFromWiki).not.toHaveBeenCalled()
    })

    it('returns "No relevant memories found." when readFromWiki throws', async () => {
      mockReadFromWiki.mockRejectedValue(new Error('SQLite locked'))
      const wiki = {} as any
      const execs = createEdgeToolExecutors('char-1', wiki)
      const result = await execs['search_memory']({ query: 'coffee' })
      expect(result).toBe('No relevant memories found.')
    })
  })
})

describe('createEdgeToolExecutors — write_observation', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('write_observation is present in executor map', () => {
    const execs = createEdgeToolExecutors('char-1', null)
    expect(typeof execs['write_observation']).toBe('function')
  })

  it('returns failure message when wiki is null', async () => {
    const execs = createEdgeToolExecutors('char-1', null)
    const result = await execs['write_observation']({ summary: 'User likes tea' })
    expect(result).toBe('Failed to record observation: Invalid input or missing database.')
    expect(mockWriteToWiki).not.toHaveBeenCalled()
  })

  it('returns failure message when summary is empty string', async () => {
    const wiki = {} as any
    const execs = createEdgeToolExecutors('char-1', wiki)
    const result = await execs['write_observation']({ summary: '' })
    expect(result).toBe('Failed to record observation: Invalid input or missing database.')
    expect(mockWriteToWiki).not.toHaveBeenCalled()
  })

  it('returns failure message when summary is whitespace only', async () => {
    const wiki = {} as any
    const execs = createEdgeToolExecutors('char-1', wiki)
    const result = await execs['write_observation']({ summary: '   ' })
    expect(result).toBe('Failed to record observation: Invalid input or missing database.')
    expect(mockWriteToWiki).not.toHaveBeenCalled()
  })

  it('returns failure message when summary is missing from args', async () => {
    const wiki = {} as any
    const execs = createEdgeToolExecutors('char-1', wiki)
    const result = await execs['write_observation']({})
    expect(result).toBe('Failed to record observation: Invalid input or missing database.')
    expect(mockWriteToWiki).not.toHaveBeenCalled()
  })

  it('returns failure message when summary is not a string', async () => {
    const wiki = {} as any
    const execs = createEdgeToolExecutors('char-1', wiki)
    const result = await execs['write_observation']({ summary: 42 })
    expect(result).toBe('Failed to record observation: Invalid input or missing database.')
    expect(mockWriteToWiki).not.toHaveBeenCalled()
  })

  it('calls writeToWiki with characterId and observation payload', async () => {
    mockWriteToWiki.mockResolvedValue(undefined)
    const wiki = {} as any
    const execs = createEdgeToolExecutors('char-42', wiki)
    await execs['write_observation']({ summary: 'User prefers dark mode' })
    expect(mockWriteToWiki).toHaveBeenCalledWith(wiki, 'char-42', {
      event_type: 'observation',
      summary: 'User prefers dark mode',
    })
  })

  it('returns success message on successful write', async () => {
    mockWriteToWiki.mockResolvedValue(undefined)
    const wiki = {} as any
    const execs = createEdgeToolExecutors('char-1', wiki)
    const result = await execs['write_observation']({ summary: 'User likes jazz' })
    expect(result).toBe('Observation recorded successfully.')
  })

  it('returns internal error message when writeToWiki throws', async () => {
    mockWriteToWiki.mockRejectedValue(new Error('SQLite locked'))
    const wiki = {} as any
    const execs = createEdgeToolExecutors('char-1', wiki)
    const result = await execs['write_observation']({ summary: 'User likes jazz' })
    expect(result).toBe('Failed to record observation due to an internal error.')
  })
})

describe('createEdgeToolExecutors — create_task', () => {
  beforeEach(() => jest.clearAllMocks())

  it('create_task is present in executor map', () => {
    const execs = createEdgeToolExecutors('char-1', null)
    expect(typeof execs['create_task']).toBe('function')
  })

  it('returns failure message when title is missing', async () => {
    const execs = createEdgeToolExecutors('char-1', null)
    const result = await execs['create_task']({})
    expect(result).toBe('Failed to create task: title is required.')
    expect(mockCreateTask).not.toHaveBeenCalled()
  })

  it('returns failure message when title is empty string', async () => {
    const execs = createEdgeToolExecutors('char-1', null)
    const result = await execs['create_task']({ title: '' })
    expect(result).toBe('Failed to create task: title is required.')
    expect(mockCreateTask).not.toHaveBeenCalled()
  })

  it('calls createTask with characterId and title', async () => {
    mockCreateTask.mockResolvedValue('task_123')
    const execs = createEdgeToolExecutors('char-42', null)
    await execs['create_task']({ title: 'Buy milk' })
    expect(mockCreateTask).toHaveBeenCalledWith('char-42', 'Buy milk')
  })

  it('returns success message on valid title', async () => {
    mockCreateTask.mockResolvedValue('task_123')
    const execs = createEdgeToolExecutors('char-1', null)
    const result = await execs['create_task']({ title: 'Buy milk' })
    expect(result).toBe(JSON.stringify({ taskId: 'task_123', title: 'Buy milk' }))
  })

  it('returns error message when createTask throws', async () => {
    mockCreateTask.mockRejectedValue(new Error('DB locked'))
    const execs = createEdgeToolExecutors('char-1', null)
    const result = await execs['create_task']({ title: 'Buy milk' })
    expect(result).toBe('Failed to create task due to an internal error.')
  })
})

describe('createEdgeToolExecutors — list_tasks', () => {
  beforeEach(() => jest.clearAllMocks())

  it('list_tasks is present in executor map', () => {
    const execs = createEdgeToolExecutors('char-1', null)
    expect(typeof execs['list_tasks']).toBe('function')
  })

  it('returns "No tasks found." when list is empty', async () => {
    mockListTasks.mockResolvedValue([])
    const execs = createEdgeToolExecutors('char-1', null)
    const result = await execs['list_tasks']({})
    expect(result).toBe('No tasks found.')
  })

  it('returns JSON string with task data when tasks exist', async () => {
    const tasks: LocalTask[] = [
      { id: 'task_1', character_id: 'char-1', title: 'Buy milk', status: 'pending', created_at: 1000 },
    ]
    mockListTasks.mockResolvedValue(tasks)
    const execs = createEdgeToolExecutors('char-1', null)
    const result = await execs['list_tasks']({})
    const parsed = JSON.parse(result as string)
    expect(parsed[0].title).toBe('Buy milk')
    expect(parsed[0].status).toBe('pending')
  })

  it('calls listTasks with correct characterId', async () => {
    mockListTasks.mockResolvedValue([])
    const execs = createEdgeToolExecutors('char-42', null)
    await execs['list_tasks']({})
    expect(mockListTasks).toHaveBeenCalledWith('char-42')
  })

  it('returns error message when listTasks throws', async () => {
    mockListTasks.mockRejectedValue(new Error('DB locked'))
    const execs = createEdgeToolExecutors('char-1', null)
    const result = await execs['list_tasks']({})
    expect(result).toBe('Failed to list tasks due to an internal error.')
  })
})
