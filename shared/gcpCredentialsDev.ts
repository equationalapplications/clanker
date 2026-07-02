export const GCP_CREDENTIALS_EXPIRED_CODE = 'GCP_CREDENTIALS_EXPIRED'

export const GCP_CREDENTIALS_DEV_CONSOLE_HINT =
  'Local cloud-agent could not authenticate to Vertex AI (expired Application Default Credentials). ' +
  'On your Mac run:\n' +
  '  gcloud auth application-default login\n' +
  '  gcloud auth application-default set-quota-project clanker-prod\n' +
  'Then restart docker:\n' +
  '  GCP_PROJECT=clanker-prod docker compose -f docker-compose.local.yml restart cloud-agent'

export function isLikelyGcpCredentialsError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '')
  const lower = message.toLowerCase()
  return (
    lower.includes('invalid_grant') ||
    lower.includes('invalid_rapt') ||
    lower.includes('reauth related error') ||
    lower.includes('could not load the default credentials') ||
    lower.includes('application default credentials')
  )
}

export function formatCloudAgentGcpCredentialsError(): { code: string; message: string } {
  return {
    code: GCP_CREDENTIALS_EXPIRED_CODE,
    message: 'Vertex AI credentials expired or missing',
  }
}
