import { useEffect } from 'react'
import * as Notifications from 'expo-notifications'
import { BackgroundNotificationTaskResult } from 'expo-notifications'
import * as TaskManager from 'expo-task-manager'
import { getAuth } from '@react-native-firebase/auth'
import { getCloudAgentBaseUrl } from '../../shared/localCloudAgent'

export const APPROVAL_TASK = 'BROWSER_ACTION_APPROVAL_RESPONSE'

// Must run at module scope so the task is registered before React mounts.
if (!TaskManager.isTaskDefined(APPROVAL_TASK)) {
  TaskManager.defineTask<Notifications.NotificationTaskPayload>(APPROVAL_TASK, async ({ data }) => {
    try {
      if (!('actionIdentifier' in data)) return BackgroundNotificationTaskResult.NoData
      const { actionIdentifier, notification } = data
      // Ignore plain notification body taps — only act on explicit APPROVE/DENY button presses.
      if (actionIdentifier !== 'APPROVE' && actionIdentifier !== 'DENY') return BackgroundNotificationTaskResult.NoData
      const { sessionId, taskId } = notification.request.content.data as { sessionId: string; taskId: string }
      const user = getAuth().currentUser
      if (!user) return BackgroundNotificationTaskResult.NoData

      const idToken = await user.getIdToken()
      const response = await fetch(`${getCloudAgentBaseUrl()}/agent/browser/approve-action`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          sessionId,
          taskId,
          approve: actionIdentifier === 'APPROVE',
        }),
      })
      if (!response.ok) throw new Error(`approve-action failed: ${response.status}`)
    } catch (err) {
      console.error('Browser action approval handler error:', err)
    }
    return BackgroundNotificationTaskResult.NoData
  })
}

export async function setupBrowserActionApproval(): Promise<void> {
  await Notifications.setNotificationCategoryAsync('BROWSER_ACTION_APPROVAL', [
    {
      identifier: 'APPROVE',
      buttonTitle: 'Approve',
      options: { opensAppToForeground: false },
    },
    {
      identifier: 'DENY',
      buttonTitle: 'Deny',
      options: { opensAppToForeground: false },
    },
  ])

  await Notifications.registerTaskAsync(APPROVAL_TASK)
}

export function useBrowserActionApproval(): void {
  useEffect(() => {
    void setupBrowserActionApproval()
  }, [])
}
