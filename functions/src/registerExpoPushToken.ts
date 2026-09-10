import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https'
import * as logger from 'firebase-functions/logger'
import { CLOUD_SQL_SECRETS } from './cloudSqlSecrets.js'
import { userRepository } from './services/userRepository.js'
import { fetchExpoPushTokenFromWebDevice } from './services/expoPushRegistration.js'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type WebDevicePushRegistration = {
  type: 'web'
  data: {
    endpoint: string
    keys: { p256dh: string; auth: string }
  }
}

type RegisterExpoPushTokenPayload =
  | { kind?: 'token'; expoPushToken: string; capabilities: { proactivePush: boolean } }
  | {
      kind?: 'web'
      webDevicePushToken: WebDevicePushRegistration
      projectId: string
      applicationId: string
      deviceId: string
      capabilities: { proactivePush: boolean }
    }
  | {
      kind: 'capabilities-only'
      capabilities: { proactivePush: boolean }
    }

type RegisterExpoPushTokenDeps = {
  userRepository: Pick<typeof userRepository, 'findUserByFirebaseUid' | 'updateUser'>
  fetchExpoPushTokenFromWebDevice: typeof fetchExpoPushTokenFromWebDevice
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseCapabilities(value: unknown): { proactivePush: boolean } {
  // Absent → false. The flag is only ever written alongside a token, and the
  // write is explicit in both directions so an old replacement device actively
  // clears a new device's readiness (Decision 1).
  if (value === undefined) return { proactivePush: false }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new HttpsError('invalid-argument', 'capabilities must be an object.')
  }
  const proactivePush = (value as { proactivePush?: unknown }).proactivePush
  if (proactivePush !== undefined && typeof proactivePush !== 'boolean') {
    throw new HttpsError('invalid-argument', 'capabilities.proactivePush must be a boolean.')
  }
  return { proactivePush: proactivePush === true }
}

function parsePayload(data: unknown): RegisterExpoPushTokenPayload {
  if (!isRecord(data)) {
    throw new HttpsError('invalid-argument', 'Request body must be an object.')
  }

  if (typeof data.expoPushToken === 'string' && data.expoPushToken.trim().length > 0) {
    return {
      expoPushToken: data.expoPushToken.trim(),
      capabilities: parseCapabilities(data.capabilities),
    }
  }

  // Capability-only downgrade path. No token supplied — the user disabled
  // notifications and the client needs the server to clear proactivePushReady
  // without overwriting expo_push_token (which may still belong to another
  // device, or to the same device after they re-enable). The handler routes
  // this to an update that touches only the flag.
  if (data.expoPushToken === undefined && data.webDevicePushToken === undefined) {
    return {
      kind: 'capabilities-only',
      capabilities: parseCapabilities(data.capabilities),
    }
  }

  const webDevicePushToken = data.webDevicePushToken
  if (!isRecord(webDevicePushToken) || webDevicePushToken.type !== 'web') {
    throw new HttpsError('invalid-argument', 'webDevicePushToken.type must be "web".')
  }

  const tokenData = webDevicePushToken.data
  if (
    !isRecord(tokenData) ||
    typeof tokenData.endpoint !== 'string' ||
    tokenData.endpoint.length === 0
  ) {
    throw new HttpsError('invalid-argument', 'webDevicePushToken.data.endpoint is required.')
  }

  const keys = tokenData.keys
  if (
    !isRecord(keys) ||
    typeof keys.p256dh !== 'string' ||
    keys.p256dh.length === 0 ||
    typeof keys.auth !== 'string' ||
    keys.auth.length === 0
  ) {
    throw new HttpsError('invalid-argument', 'webDevicePushToken.data.keys are required.')
  }

  const projectId = data.projectId
  if (typeof projectId !== 'string' || !UUID_REGEX.test(projectId)) {
    throw new HttpsError('invalid-argument', 'projectId must be a valid UUID.')
  }

  const applicationId = data.applicationId
  if (typeof applicationId !== 'string' || applicationId.trim().length === 0) {
    throw new HttpsError('invalid-argument', 'applicationId is required.')
  }

  const deviceId = data.deviceId
  if (typeof deviceId !== 'string' || deviceId.trim().length === 0) {
    throw new HttpsError('invalid-argument', 'deviceId is required.')
  }

  return {
    kind: 'web',
    webDevicePushToken: {
      type: 'web',
      data: {
        endpoint: tokenData.endpoint,
        keys: { p256dh: keys.p256dh, auth: keys.auth },
      },
    },
    projectId,
    applicationId: applicationId.trim(),
    deviceId: deviceId.trim(),
    capabilities: parseCapabilities(data.capabilities),
  }
}

export const registerExpoPushTokenHandler = async (
  request: CallableRequest,
  deps: RegisterExpoPushTokenDeps = {
    userRepository,
    fetchExpoPushTokenFromWebDevice,
  },
): Promise<{ ok: true }> => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Authentication required.')
  }

  const payload = parsePayload(request.data)
  const user = await deps.userRepository.findUserByFirebaseUid(request.auth.uid)
  if (!user) {
    throw new HttpsError('not-found', 'User not found.')
  }

  if (payload.kind === 'capabilities-only') {
    // Downgrade: clear the flag without touching the existing token. expoPushToken
    // stays as-is so a later re-enable (or another device's token) is preserved.
    const updated = await deps.userRepository.updateUser(user.id, {
      proactivePushReady: payload.capabilities.proactivePush,
    })
    if (!updated) {
      throw new HttpsError('not-found', 'User not found.')
    }
    return { ok: true }
  }
  let expoPushToken: string
  if ('expoPushToken' in payload) {
    expoPushToken = payload.expoPushToken
  } else {
    try {
      expoPushToken = await deps.fetchExpoPushTokenFromWebDevice({
        deviceToken: JSON.stringify(payload.webDevicePushToken.data),
        projectId: payload.projectId,
        applicationId: payload.applicationId,
        deviceId: payload.deviceId,
      })
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      logger.error('Expo web push token exchange failed', { detail, uid: request.auth.uid })
      throw new HttpsError('internal', 'Failed to register web push token.')
    }
  }

  const updated = await deps.userRepository.updateUser(user.id, {
    expoPushToken,
    proactivePushReady: payload.capabilities.proactivePush,
  })
  if (!updated) {
    throw new HttpsError('not-found', 'User not found.')
  }

  return { ok: true }
}

export const registerExpoPushToken = onCall(
  {
    region: 'us-central1',
    enforceAppCheck: true,
    invoker: 'public',
    secrets: [...CLOUD_SQL_SECRETS],
  },
  (request) => registerExpoPushTokenHandler(request),
)
