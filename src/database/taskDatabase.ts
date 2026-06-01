import { getDatabase } from './index'

export interface LocalTask {
  id: string
  character_id: string
  title: string
  status: string
  created_at: number
}

export async function createTask(characterId: string, title: string): Promise<string> {
  const db = await getDatabase()
  const id =
    globalThis.crypto?.randomUUID?.() ??
    `task_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`
  await db.runAsync(
    'INSERT INTO tasks (id, character_id, title, status, created_at) VALUES (?, ?, ?, ?, ?)',
    [id, characterId, title, 'pending', Date.now()],
  )
  return id
}

export async function listTasks(characterId: string): Promise<LocalTask[]> {
  const db = await getDatabase()
  return db.getAllAsync<LocalTask>(
    'SELECT * FROM tasks WHERE character_id = ? ORDER BY created_at DESC',
    [characterId],
  )
}