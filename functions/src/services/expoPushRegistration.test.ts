import test from 'node:test'
import assert from 'node:assert/strict'
import { fetchExpoPushTokenFromWebDevice } from './expoPushRegistration.js'

test('fetchExpoPushTokenFromWebDevice posts web payload to Expo and returns token', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init })
    return new Response(JSON.stringify({ data: { expoPushToken: 'ExponentPushToken[web]' } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }

  const token = await fetchExpoPushTokenFromWebDevice(
    {
      deviceToken: JSON.stringify({
        endpoint: 'https://push.example/abc',
        keys: { p256dh: 'p', auth: 'a' },
      }),
      projectId: '2333eead-a87c-4a6f-adea-b1b433f4740e',
      applicationId: 'com.equationalapplications.clanker',
      deviceId: 'DEVICE-ID-UPPER',
    },
    fetchImpl as typeof fetch,
  )

  assert.equal(token, 'ExponentPushToken[web]')
  assert.equal(calls[0].url, 'https://exp.host/--/api/v2/push/getExpoPushToken')
  const body = JSON.parse(String(calls[0].init?.body))
  assert.equal(body.type, 'fcm')
  assert.equal(body.deviceId, 'device-id-upper')
})
