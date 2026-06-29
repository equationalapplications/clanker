import { renderHook, waitFor } from '@testing-library/react-native'
import { useRegisterExpoPushToken } from '~/hooks/useRegisterExpoPushToken'

jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn().mockResolvedValue({ status: 'undetermined' }),
  requestPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  getExpoPushTokenAsync: jest.fn().mockResolvedValue({ data: 'ExponentPushToken[test]' }),
  setNotificationCategoryAsync: jest.fn().mockResolvedValue(true),
}))

jest.mock('~/config/firebaseConfig', () => ({
  getCurrentUser: jest.fn().mockReturnValue({ getIdToken: jest.fn().mockResolvedValue('id-tok') }),
}))

jest.mock('../shared/localCloudAgent', () => ({
  getCloudAgentBaseUrl: () => 'https://agent.test',
}))

describe('useRegisterExpoPushToken', () => {
  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }) as jest.Mock
  })

  it('registers token and POSTs to cloud agent', async () => {
    renderHook(() => useRegisterExpoPushToken({ enabled: true, projectId: 'test-proj' }))
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/agent/user/expo-push-token'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            authorization: 'Bearer id-tok',
            'content-type': 'application/json',
          }),
          body: JSON.stringify({ expoPushToken: 'ExponentPushToken[test]' }),
        }),
      )
    })
  })
})
