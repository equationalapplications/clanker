import { DEV_CLOUD_CHARACTER_ID } from '../shared/dev-sandbox'
import {
  getCloudAgentBaseUrl,
  isLocalCloudAgentUrl,
  resolveCloudAgentCharacterId,
} from '../shared/localCloudAgent'

const PROD_CHAR_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

describe('isLocalCloudAgentUrl', () => {
  it('returns true for loopback and private LAN hosts', () => {
    expect(isLocalCloudAgentUrl('http://localhost:8080')).toBe(true)
    expect(isLocalCloudAgentUrl('http://127.0.0.1:8080/agent/run')).toBe(true)
    expect(isLocalCloudAgentUrl('http://192.168.1.80:8080')).toBe(true)
    expect(isLocalCloudAgentUrl('http://10.0.0.1:8080/agent/stream')).toBe(true)
  })

  it('returns false for production Cloud Run URLs', () => {
    expect(isLocalCloudAgentUrl('https://clanker-cloud-agent-zbvqu57cca-uc.a.run.app')).toBe(false)
  })

  it('returns false for empty input', () => {
    expect(isLocalCloudAgentUrl('')).toBe(false)
  })
})

describe('getCloudAgentBaseUrl', () => {
  it('rejects production Cloud Run URL when mock auth is enabled', () => {
    const previousUrl = process.env.EXPO_PUBLIC_CLOUD_AGENT_URL
    const previousMockAuth = process.env.EXPO_PUBLIC_USE_MOCK_AUTH
    process.env.EXPO_PUBLIC_CLOUD_AGENT_URL = 'https://clanker-cloud-agent-zbvqu57cca-uc.a.run.app'
    process.env.EXPO_PUBLIC_USE_MOCK_AUTH = 'true'
    try {
      expect(() => getCloudAgentBaseUrl()).toThrow(/mock_token_123/)
    } finally {
      if (previousUrl === undefined) {
        delete process.env.EXPO_PUBLIC_CLOUD_AGENT_URL
      } else {
        process.env.EXPO_PUBLIC_CLOUD_AGENT_URL = previousUrl
      }
      if (previousMockAuth === undefined) {
        delete process.env.EXPO_PUBLIC_USE_MOCK_AUTH
      } else {
        process.env.EXPO_PUBLIC_USE_MOCK_AUTH = previousMockAuth
      }
    }
  })
})

describe('resolveCloudAgentCharacterId', () => {
  it('rewrites to DEV_CLOUD_CHARACTER_ID for local Docker in dev builds', () => {
    const previousUrl = process.env.EXPO_PUBLIC_CLOUD_AGENT_URL
    process.env.EXPO_PUBLIC_CLOUD_AGENT_URL = 'http://192.168.1.80:8080'
    try {
      expect(resolveCloudAgentCharacterId(PROD_CHAR_ID)).toBe(DEV_CLOUD_CHARACTER_ID)
    } finally {
      if (previousUrl === undefined) {
        delete process.env.EXPO_PUBLIC_CLOUD_AGENT_URL
      } else {
        process.env.EXPO_PUBLIC_CLOUD_AGENT_URL = previousUrl
      }
    }
  })

  it('passes through production character IDs when URL is Cloud Run', () => {
    const previousUrl = process.env.EXPO_PUBLIC_CLOUD_AGENT_URL
    process.env.EXPO_PUBLIC_CLOUD_AGENT_URL = 'https://clanker-cloud-agent-zbvqu57cca-uc.a.run.app'
    try {
      expect(resolveCloudAgentCharacterId(PROD_CHAR_ID)).toBe(PROD_CHAR_ID)
    } finally {
      if (previousUrl === undefined) {
        delete process.env.EXPO_PUBLIC_CLOUD_AGENT_URL
      } else {
        process.env.EXPO_PUBLIC_CLOUD_AGENT_URL = previousUrl
      }
    }
  })
})
