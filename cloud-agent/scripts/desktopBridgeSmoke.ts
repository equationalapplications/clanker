// cloud-agent/scripts/desktopBridgeSmoke.ts
// Manual smoke test against the local Docker stack (docker-compose.local.yml).
// Usage:
//   1. docker compose -f ../docker-compose.local.yml up -d
//   2. Obtain a pairing token: POST /agent/desktop/pair with a real auth token, or
//      insert a desktopPairings doc + device doc directly via the emulator/console.
//   3. PAIRING_TOKEN=<token> CLOUD_AGENT_URL=ws://localhost:8080 npx tsx scripts/desktopBridgeSmoke.ts
import WebSocket from 'ws'

const base = process.env.CLOUD_AGENT_URL ?? 'ws://localhost:8080'
const url = base.endsWith('/agent/desktop') ? base : `${base.replace(/\/$/, '')}/agent/desktop`
const token = process.env.PAIRING_TOKEN
if (!token) { console.error('PAIRING_TOKEN required'); process.exit(1) }

const ws = new WebSocket(url)
ws.on('open', () => {
  console.log('connected, sending auth')
  ws.send(JSON.stringify({ type: 'auth', pairingToken: token }))
  setInterval(() => ws.send(JSON.stringify({ type: 'ping' })), 20_000)
})
ws.on('message', (data) => {
  const frame = JSON.parse(data.toString()) as { type: string; taskId?: string; tool?: string; params?: unknown }
  console.log('<<', frame)
  if (frame.type === 'task') {
    ws.send(JSON.stringify({
      type: 'task_result',
      taskId: frame.taskId,
      result: [{ id: 'entry-1', entity_id: 'tier_fact', title: `canned result for ${frame.tool}`, score: 0.99 }],
    }))
  }
})
ws.on('close', (code, reason) => console.log('closed', code, reason.toString()))
ws.on('error', (err) => console.error('error', err))
