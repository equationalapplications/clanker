import admin from 'firebase-admin'

interface ApproveActionBody {
  sessionId: string
  taskId: string
  approve: boolean
  idToken: string
}

interface FirestoreLite {
  doc(path: string): { update(data: Record<string, unknown>): Promise<void> }
}

export async function handleApproveAction(
  db: FirestoreLite,
  uid: string,
  body: ApproveActionBody,
): Promise<void> {
  const authPath = `users/${uid}/sessions/${body.sessionId}/auth/${body.taskId}`
  if (body.approve) {
    await db.doc(authPath).update({
      status: 'approved',
      approvalToken: body.idToken,
      approvedAt: admin.firestore?.Timestamp?.now?.() ?? new Date(),
    })
  } else {
    await db.doc(authPath).update({ status: 'denied' })
  }
}
