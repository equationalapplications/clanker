import { edgeToolExecutors, createEdgeToolExecutors } from '../edgeToolExecutors'
import { readFromWiki, writeToWiki } from '../wikiService'
import {
  createTask,
  listTasks,
  updateTask,
  completeTask,
  deleteTask,
} from '../../database/taskDatabase'
import type { LocalTask } from '../../database/taskDatabase'
import { formatGraphContext } from '@equationalapplications/core-llm-wiki'
import { generateImageViaCallable } from '../imageGenerationService'
import { scheduleWakeupViaCallable } from '../proactiveWakeupService'
import { saveCharacterImage } from '../characterImageService'

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

jest.mock('../imageGenerationService', () => ({
  generateImageViaCallable: jest.fn(),
}))

jest.mock('../proactiveWakeupService', () => ({
  scheduleWakeupViaCallable: jest.fn(),
}))

jest.mock('../characterImageService', () => ({
  saveCharacterImage: jest.fn(),
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
      {
        id: 'task_1',
        character_id: 'char-1',
        title: 'Buy milk',
        status: 'pending',
        created_at: 1000,
      },
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
    expect(result).toBe('Failed to traverse graph: wiki database is unavailable.')
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

const mockGenerateImageViaCallable = generateImageViaCallable as jest.Mock
const mockSaveCharacterImage = saveCharacterImage as jest.Mock

describe('generate_image local executor (non-cloud-synced characters)', () => {
  const imageDeps = () => ({
    userId: 'u1',
    messageId: 'ai_1',
    onImageSaved: jest.fn(),
  })

  it('is absent unless image deps are supplied', () => {
    expect(createEdgeToolExecutors('char-1', null).generate_image).toBeUndefined()
  })

  it('generates, persists with the pre-minted message id, and reports the image id', async () => {
    mockGenerateImageViaCallable.mockResolvedValue({
      imageBase64: 'AAAA',
      mimeType: 'image/png',
    })
    mockSaveCharacterImage.mockResolvedValue({ id: 'img-1' })
    const deps = imageDeps()

    const executors = createEdgeToolExecutors('char-1', null, deps)
    const result = await executors.generate_image({ prompt: 'a red bicycle' })

    expect(mockGenerateImageViaCallable).toHaveBeenCalledWith('a red bicycle')
    const saved = mockSaveCharacterImage.mock.calls[0][0]
    expect(saved).toMatchObject({
      characterId: 'char-1',
      userId: 'u1',
      source: 'chat',
      messageId: 'ai_1',
      uri: 'data:image/png;base64,AAAA',
    })
    expect(deps.onImageSaved).toHaveBeenCalledWith(saved.imageId)
    // The model gets a status, never the bytes — they would be tokenized into context.
    expect(String(result)).not.toContain('AAAA')
  })

  it('caps generation at one image per turn instead of spending twice', async () => {
    mockGenerateImageViaCallable.mockResolvedValue({ imageBase64: 'A', mimeType: 'image/png' })
    mockSaveCharacterImage.mockResolvedValue({ id: 'img-1' })
    const executors = createEdgeToolExecutors('char-1', null, imageDeps())

    await executors.generate_image({ prompt: 'one' })
    const second = await executors.generate_image({ prompt: 'two' })

    expect(mockGenerateImageViaCallable).toHaveBeenCalledTimes(1)
    expect(String(second)).toMatch(/one image/i)
  })

  it('returns a sentence the model can apologize with when generation fails', async () => {
    mockGenerateImageViaCallable.mockRejectedValue(new Error('vertex boom'))
    const deps = imageDeps()
    const executors = createEdgeToolExecutors('char-1', null, deps)

    const result = await executors.generate_image({ prompt: 'a cat' })

    expect(mockSaveCharacterImage).not.toHaveBeenCalled()
    expect(deps.onImageSaved).not.toHaveBeenCalled()
    expect(typeof result).toBe('string')
  })

  it('does not consume the one-image cap on a failed attempt', async () => {
    mockGenerateImageViaCallable.mockRejectedValueOnce(new Error('boom')).mockResolvedValue({
      imageBase64: 'A',
      mimeType: 'image/png',
    })
    mockSaveCharacterImage.mockResolvedValue({ id: 'img-1' })
    const executors = createEdgeToolExecutors('char-1', null, imageDeps())

    await executors.generate_image({ prompt: 'first' })
    await executors.generate_image({ prompt: 'retry' })

    expect(mockGenerateImageViaCallable).toHaveBeenCalledTimes(2)
  })
})

describe('generate_image billing safety', () => {
  const imageDeps = () => ({ userId: 'u1', messageId: 'ai_1', onImageSaved: jest.fn() })

  it('bills once when the model fires two calls concurrently in one response', async () => {
    let resolveGen: (v: unknown) => void = () => {}
    mockGenerateImageViaCallable.mockImplementation(
      () => new Promise((res) => (resolveGen = res as (v: unknown) => void)),
    )
    mockSaveCharacterImage.mockResolvedValue({ id: 'img-1' })
    const executors = createEdgeToolExecutors('char-1', null, imageDeps())

    // Promise.all in useEdgeAgent dispatches both before either awaits.
    const both = Promise.all([
      executors.generate_image({ prompt: 'one' }),
      executors.generate_image({ prompt: 'two' }),
    ])
    resolveGen({ imageBase64: 'A', mimeType: 'image/png' })
    await both

    expect(mockGenerateImageViaCallable).toHaveBeenCalledTimes(1)
  })

  it('releases the in-flight reservation when a concurrent generation rejects, so later calls are not blocked', async () => {
    let rejectGen: (e: Error) => void = () => {}
    mockGenerateImageViaCallable.mockImplementation(
      () => new Promise((_, rej) => (rejectGen = rej)),
    )
    const executors = createEdgeToolExecutors('char-1', null, imageDeps())

    const first = executors.generate_image({ prompt: 'doomed' })
    // A second call overlapping the in-flight reservation gets the cap message
    // without reaching the callable, so rejectGen still targets the first call.
    const concurrent = executors.generate_image({ prompt: 'concurrent' })
    await expect(concurrent).resolves.toContain('one image per reply')
    rejectGen(new Error('vertex boom'))
    await first

    // The failed call never billed, so the reservation must be gone: a fresh
    // call reaches the callable instead of getting the cap message forever.
    mockGenerateImageViaCallable.mockResolvedValue({ imageBase64: 'A', mimeType: 'image/png' })
    mockSaveCharacterImage.mockResolvedValue({ id: 'img-1' })
    await executors.generate_image({ prompt: 'retry' })

    expect(mockGenerateImageViaCallable).toHaveBeenCalledTimes(2)
  })

  it('consumes the cap when the image was billed but persistence failed', async () => {
    mockGenerateImageViaCallable.mockResolvedValue({ imageBase64: 'A', mimeType: 'image/png' })
    mockSaveCharacterImage.mockRejectedValue(new Error('disk full'))
    const executors = createEdgeToolExecutors('char-1', null, imageDeps())

    await executors.generate_image({ prompt: 'first' })
    await executors.generate_image({ prompt: 'retry' })

    // The credits are already spent and cannot be refunded from the client, so a
    // retry must not bill a second time.
    expect(mockGenerateImageViaCallable).toHaveBeenCalledTimes(1)
  })
})

const mockScheduleWakeupViaCallable = scheduleWakeupViaCallable as jest.Mock

describe('set_reminder executor', () => {
  it('is absent when no reminder deps are provided (non-synced character keeps existing behavior)', () => {
    const executors = createEdgeToolExecutors('char-1', null)
    expect(executors.set_reminder).toBeUndefined()
  })

  it('calls the callable with the session-bound cloud character id and returns its message', async () => {
    mockScheduleWakeupViaCallable.mockResolvedValue({
      ok: true,
      message: 'Scheduled. You will wake up at 2026-09-10T10:00:00.000Z to follow up on this.',
      dueAt: '2026-09-10T10:00:00.000Z',
    })
    const executors = createEdgeToolExecutors('char-1', null, undefined, {
      characterId: 'cloud-9',
      scheduleWakeup: mockScheduleWakeupViaCallable,
    })
    const out = await executors.set_reminder!({
      reason: 'follow up on the recipe',
      remind_at: '2026-09-10T10:00:00.000Z',
      priority: 2,
    })
    expect(mockScheduleWakeupViaCallable).toHaveBeenCalledWith({
      characterId: 'cloud-9',
      reason: 'follow up on the recipe',
      remindAt: '2026-09-10T10:00:00.000Z',
      priority: 2,
      opId: expect.stringMatching(/^op-[0-9a-f]{8}$/),
    })
    expect(out).toBe(
      'Scheduled. You will wake up at 2026-09-10T10:00:00.000Z to follow up on this.',
    )
  })

  it('derives a stable opId so a retry with the same args hits the same row', async () => {
    mockScheduleWakeupViaCallable.mockResolvedValue({
      ok: true,
      message: 'Scheduled.',
      dueAt: '2026-09-10T10:00:00.000Z',
    })
    const executors = createEdgeToolExecutors('char-1', null, undefined, {
      characterId: 'cloud-9',
      scheduleWakeup: mockScheduleWakeupViaCallable,
    })
    const callArgs = {
      reason: 'follow up',
      remind_at: '2026-09-10T10:00:00.000Z',
    }
    await executors.set_reminder!(callArgs)
    await executors.set_reminder!(callArgs)
    const first = (mockScheduleWakeupViaCallable.mock.calls[0][0] as { opId: string }).opId
    const second = (mockScheduleWakeupViaCallable.mock.calls[1][0] as { opId: string }).opId
    expect(first).toBe(second)
  })

  it('surfaces a callable refusal (ceiling) to the model as the tool result', async () => {
    mockScheduleWakeupViaCallable.mockResolvedValue({
      ok: false,
      message:
        'Not scheduled: this character has reached its background activity limit for today. Do not promise the user a follow-up for today.',
    })
    const executors = createEdgeToolExecutors('char-1', null, undefined, {
      characterId: 'cloud-9',
      scheduleWakeup: mockScheduleWakeupViaCallable,
    })
    const out = await executors.set_reminder!({
      reason: 'r',
      remind_at: '2026-09-10T10:00:00.000Z',
    })
    expect(out).toMatch(/background activity limit/)
  })

  it('surfaces a callable failure as a tool-error string, not a thrown crash of the turn', async () => {
    mockScheduleWakeupViaCallable.mockRejectedValue(new Error('network down'))
    const executors = createEdgeToolExecutors('char-1', null, undefined, {
      characterId: 'cloud-9',
      scheduleWakeup: mockScheduleWakeupViaCallable,
    })
    const out = await executors.set_reminder!({
      reason: 'r',
      remind_at: '2026-09-10T10:00:00.000Z',
    })
    expect(out).toBe('Not scheduled: an internal error occurred.')
  })
})
