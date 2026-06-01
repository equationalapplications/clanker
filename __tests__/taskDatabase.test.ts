import { createTask, listTasks } from '../src/database/taskDatabase'
import { getDatabase } from '../src/database/index'

jest.mock('../src/database/index', () => ({
  getDatabase: jest.fn(),
}))

const mockDb = {
  runAsync: jest.fn(),
  getAllAsync: jest.fn(),
}

const mockGetDatabase = getDatabase as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  mockGetDatabase.mockResolvedValue(mockDb)
})

describe('createTask', () => {
  it('inserts a task row and returns an id string', async () => {
    mockDb.runAsync.mockResolvedValue(undefined)
    const id = await createTask('char-1', 'Buy milk')
    expect(typeof id).toBe('string')
    expect(
      id.startsWith('task_') || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id),
    ).toBe(true)
    expect(mockDb.runAsync).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO tasks'),
      expect.arrayContaining(['char-1', 'Buy milk', 'pending']),
    )
  })

  it('passes the generated id as first bind param', async () => {
    mockDb.runAsync.mockResolvedValue(undefined)
    const id = await createTask('char-1', 'Walk dog')
    const callArgs = mockDb.runAsync.mock.calls[0][1] as string[]
    expect(callArgs[0]).toBe(id)
  })
})

describe('listTasks', () => {
  it('returns rows from the tasks table for the given character', async () => {
    const rows = [
      {
        id: 'task_1',
        character_id: 'char-1',
        title: 'Buy milk',
        status: 'pending',
        created_at: 1000,
      },
    ]
    mockDb.getAllAsync.mockResolvedValue(rows)
    const result = await listTasks('char-1')
    expect(result).toEqual(rows)
    expect(mockDb.getAllAsync).toHaveBeenCalledWith(
      expect.stringContaining('SELECT * FROM tasks WHERE character_id = ?'),
      ['char-1'],
    )
  })

  it('returns empty array when no tasks exist', async () => {
    mockDb.getAllAsync.mockResolvedValue([])
    const result = await listTasks('char-1')
    expect(result).toEqual([])
  })
})