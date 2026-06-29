jest.mock('expo-notifications', () => ({
  setNotificationCategoryAsync: jest.fn().mockResolvedValue(true),
  registerTaskAsync: jest.fn().mockResolvedValue(true),
}))

jest.mock('expo-task-manager', () => ({
  defineTask: jest.fn(),
  isTaskDefined: jest.fn().mockReturnValue(false),
}))

jest.mock('@react-native-firebase/auth', () => ({
  getAuth: jest.fn().mockReturnValue({ currentUser: { getIdToken: jest.fn().mockResolvedValue('id-tok') } }),
}))

jest.mock('../shared/localCloudAgent', () => ({
  getCloudAgentBaseUrl: () => 'https://agent.test',
}))

import * as TaskManager from 'expo-task-manager'
import * as Notifications from 'expo-notifications'
import { APPROVAL_TASK, setupBrowserActionApproval } from '~/hooks/useBrowserActionApproval'

describe('setupBrowserActionApproval', () => {
  it('registers BROWSER_ACTION_APPROVAL notification category', async () => {
    await setupBrowserActionApproval()
    expect(Notifications.setNotificationCategoryAsync).toHaveBeenCalledWith(
      'BROWSER_ACTION_APPROVAL',
      expect.arrayContaining([
        expect.objectContaining({ identifier: 'APPROVE' }),
        expect.objectContaining({ identifier: 'DENY' }),
      ]),
    )
    expect(TaskManager.defineTask).toHaveBeenCalledWith(
      'BROWSER_ACTION_APPROVAL_RESPONSE',
      expect.any(Function),
    )
    expect(Notifications.registerTaskAsync).toHaveBeenCalledWith(APPROVAL_TASK)
  })
})
