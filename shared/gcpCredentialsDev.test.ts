import {
  formatCloudAgentGcpCredentialsError,
  GCP_CREDENTIALS_EXPIRED_CODE,
  isLikelyGcpCredentialsError,
} from './gcpCredentialsDev'

describe('isLikelyGcpCredentialsError', () => {
  it('detects invalid_rapt / invalid_grant ADK errors', () => {
    const err = new Error(
      'ADK error (UNKNOWN_ERROR): {"error":"invalid_grant","error_description":"reauth related error (invalid_rapt)"}',
    )
    expect(isLikelyGcpCredentialsError(err)).toBe(true)
  })

  it('returns false for unrelated errors', () => {
    expect(isLikelyGcpCredentialsError(new Error('Character not found'))).toBe(false)
  })
})

describe('formatCloudAgentGcpCredentialsError', () => {
  it('uses a stable dev-only error code', () => {
    expect(formatCloudAgentGcpCredentialsError()).toEqual({
      code: GCP_CREDENTIALS_EXPIRED_CODE,
      message: 'Vertex AI credentials expired or missing',
    })
  })
})
