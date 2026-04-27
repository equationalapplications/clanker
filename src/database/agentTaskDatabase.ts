import { getDatabase } from '~/database/index'

interface LocalAgentTask {
  id: string
  description: string
  priority: number
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
  characterId: string,
  limit: number,
): Promise<AgentTaskView[]> {
  const db = await getDatabase()
  const rows = await db.getAllAsync<LocalAgentTask>(
    `SELECT id, description, priority
     FROM agent_tasks
     WHERE character_id = ?
       AND status = 'pending'
       AND deleted_at IS NULL
     ORDER BY priority DESC, updated_at DESC
     LIMIT ?`,
    [characterId, limit],
  )

  return rows.map((row) => ({
    id: row.id,
    description: row.description,
    priorityLabel: priorityToLabel(row.priority),
  }))
}