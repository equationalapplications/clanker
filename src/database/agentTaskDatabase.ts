import { getDatabase } from '~/database/index'

interface LocalAgentTask {
  id: string
  character_id: string
  user_id: string
  description: string
  status: 'pending' | 'in_progress' | 'done' | 'abandoned'
  priority: number
  due_context: string | null
  created_at: number
  updated_at: number
  resolved_at: number | null
  resolution_note: string | null
  synced_to_cloud: number
  cloud_id: string | null
  deleted_at: number | null
}

export interface AgentTaskUpsertInput {
  id: string
  characterId: string
  userId: string
  description: string
  status?: 'pending' | 'in_progress' | 'done' | 'abandoned'
  priority?: number
  dueContext?: string | null
  createdAt?: number
  updatedAt?: number
  resolvedAt?: number | null
  resolutionNote?: string | null
  syncedToCloud?: number
  cloudId?: string | null
  deletedAt?: number | null
}

export interface AgentTaskView {
  id: string
  description: string
  priorityLabel: string
}

function priorityToLabel(priority: number): string {
  if (priority >= 2) {
    return 'high'
  }

  if (priority <= -1) {
    return 'low'
  }

  return 'normal'
}

export async function getOpenTasks(
  userId: string,
  characterId: string,
  limit: number,
): Promise<AgentTaskView[]> {
  const db = await getDatabase()
  const rows = await db.getAllAsync<LocalAgentTask>(
    `SELECT id, description, priority
     FROM agent_tasks
     WHERE character_id = ?
       AND user_id = ?
       AND status = 'pending'
       AND deleted_at IS NULL
     ORDER BY priority DESC, updated_at DESC
     LIMIT ?`,
    [characterId, userId, limit],
  )

  return rows.map((row) => ({
    id: row.id,
    description: row.description,
    priorityLabel: priorityToLabel(row.priority),
  }))
}

export async function upsertAgentTasks(tasks: AgentTaskUpsertInput[]): Promise<void> {
  if (tasks.length === 0) {
    return
  }

  const db = await getDatabase()

  await db.withTransactionAsync(async () => {
    for (const task of tasks) {
      const now = Date.now()
      await db.runAsync(
        `INSERT INTO agent_tasks (
          id,
          character_id,
          user_id,
          description,
          status,
          priority,
          due_context,
          created_at,
          updated_at,
          resolved_at,
          resolution_note,
          synced_to_cloud,
          cloud_id,
          deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          description = excluded.description,
          status = excluded.status,
          priority = excluded.priority,
          due_context = excluded.due_context,
          updated_at = excluded.updated_at,
          resolved_at = excluded.resolved_at,
          resolution_note = excluded.resolution_note,
          synced_to_cloud = excluded.synced_to_cloud,
          cloud_id = excluded.cloud_id,
          deleted_at = excluded.deleted_at`,
        [
          task.id,
          task.characterId,
          task.userId,
          task.description.trim(),
          task.status ?? 'pending',
          task.priority ?? 0,
          task.dueContext ?? null,
          task.createdAt ?? now,
          task.updatedAt ?? now,
          task.resolvedAt ?? null,
          task.resolutionNote ?? null,
          task.syncedToCloud ?? 0,
          task.cloudId ?? null,
          task.deletedAt ?? null,
        ],
      )
    }
  })
}

export async function softDeleteAgentTasks(
  characterId: string,
  userId: string,
  taskIds: string[],
): Promise<number> {
  if (taskIds.length === 0) {
    return 0
  }

  const db = await getDatabase()
  const deletedAt = Date.now()
  let changed = 0

  await db.withTransactionAsync(async () => {
    for (const taskId of taskIds) {
      const result = await db.runAsync(
        `UPDATE agent_tasks
         SET deleted_at = ?, updated_at = ?, synced_to_cloud = 0
         WHERE id = ? AND character_id = ? AND user_id = ?`,
        [deletedAt, deletedAt, taskId, characterId, userId],
      )
      changed += result.changes ?? 0
    }
  })

  return changed
}

export async function softDeleteAllAgentTasks(characterId: string, userId: string): Promise<number> {
  const db = await getDatabase()
  const deletedAt = Date.now()
  const result = await db.runAsync(
    `UPDATE agent_tasks
     SET deleted_at = ?, updated_at = ?, synced_to_cloud = 0
     WHERE character_id = ? AND user_id = ? AND deleted_at IS NULL`,
    [deletedAt, deletedAt, characterId, userId],
  )

  return result.changes ?? 0
}