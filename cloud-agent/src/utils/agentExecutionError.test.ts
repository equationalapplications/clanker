import assert from 'node:assert/strict'
import test from 'node:test'

const { mapAgentExecutionError } = await import('./agentExecutionError.js')

test('mapAgentExecutionError maps invalid_rapt to GCP_CREDENTIALS_EXPIRED in dev', () => {
  const originalKService = process.env.K_SERVICE
  const originalNodeEnv = process.env.NODE_ENV
  delete process.env.K_SERVICE
  process.env.NODE_ENV = 'development'

  try {
    const err = new Error(
      'ADK error (UNKNOWN_ERROR): {"error":"invalid_grant","error_description":"reauth related error (invalid_rapt)"}',
    )
    assert.deepEqual(mapAgentExecutionError(err), {
      code: 'GCP_CREDENTIALS_EXPIRED',
      message: 'Vertex AI credentials expired or missing',
    })
  } finally {
    if (originalKService === undefined) {
      delete process.env.K_SERVICE
    } else {
      process.env.K_SERVICE = originalKService
    }
    process.env.NODE_ENV = originalNodeEnv
  }
})

test('mapAgentExecutionError keeps INTERNAL_ERROR for unrelated failures in dev', () => {
  const originalKService = process.env.K_SERVICE
  const originalNodeEnv = process.env.NODE_ENV
  delete process.env.K_SERVICE
  process.env.NODE_ENV = 'development'

  try {
    assert.deepEqual(mapAgentExecutionError(new Error('timeout')), {
      code: 'INTERNAL_ERROR',
      message: 'Agent execution failed',
    })
  } finally {
    if (originalKService === undefined) {
      delete process.env.K_SERVICE
    } else {
      process.env.K_SERVICE = originalKService
    }
    process.env.NODE_ENV = originalNodeEnv
  }
})

test('mapAgentExecutionError does not leak GCP credential code on Cloud Run', () => {
  const originalKService = process.env.K_SERVICE
  const originalNodeEnv = process.env.NODE_ENV
  process.env.K_SERVICE = 'clanker-cloud-agent'
  process.env.NODE_ENV = 'production'

  try {
    const err = new Error('reauth related error (invalid_rapt)')
    assert.deepEqual(mapAgentExecutionError(err), {
      code: 'INTERNAL_ERROR',
      message: 'Agent execution failed',
    })
  } finally {
    if (originalKService === undefined) {
      delete process.env.K_SERVICE
    } else {
      process.env.K_SERVICE = originalKService
    }
    process.env.NODE_ENV = originalNodeEnv
  }
})
