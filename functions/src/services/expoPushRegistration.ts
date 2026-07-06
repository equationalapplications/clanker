const EXPO_GET_PUSH_TOKEN_URL = 'https://exp.host/--/api/v2/push/getExpoPushToken'

export interface WebExpoPushExchangeInput {
  deviceToken: string
  projectId: string
  applicationId: string
  deviceId: string
  development?: boolean
}

function parseExpoPushTokenResponse(data: unknown): string {
  if (
    !data ||
    typeof data !== 'object' ||
    !('data' in data) ||
    typeof (data as { data?: unknown }).data !== 'object' ||
    !(data as { data: { expoPushToken?: unknown } }).data?.expoPushToken ||
    typeof (data as { data: { expoPushToken: unknown } }).data.expoPushToken !== 'string'
  ) {
    throw new Error(`Malformed Expo push token response: ${JSON.stringify(data)}`)
  }
  return (data as { data: { expoPushToken: string } }).data.expoPushToken
}

export async function fetchExpoPushTokenFromWebDevice(
  input: WebExpoPushExchangeInput,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const response = await fetchImpl(EXPO_GET_PUSH_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      // exp.host validates type as apns|fcm|gcm only; web subscriptions use FCM endpoints.
      type: 'fcm',
      deviceId: input.deviceId.toLowerCase(),
      development: input.development ?? false,
      appId: input.applicationId,
      deviceToken: input.deviceToken,
      projectId: input.projectId,
    }),
  })

  if (!response.ok) {
    let detail = response.statusText || String(response.status)
    try {
      detail = await response.text()
    } catch {
      // ignore
    }
    throw new Error(`Expo push token exchange failed: ${detail}`)
  }

  return parseExpoPushTokenResponse(await response.json())
}
