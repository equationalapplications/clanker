import {
  formatCloudAgentGcpCredentialsError,
  isLikelyGcpCredentialsError,
} from '../../../shared/gcpCredentialsDev.js'

export function isCloudAgentDevLeakyErrors(): boolean {
  return !process.env.K_SERVICE && process.env.NODE_ENV !== 'production'
}

export function mapAgentExecutionError(err: unknown): { code: string; message: string } {
  if (isCloudAgentDevLeakyErrors() && isLikelyGcpCredentialsError(err)) {
    return formatCloudAgentGcpCredentialsError()
  }
  return { code: 'INTERNAL_ERROR', message: 'Agent execution failed' }
}
