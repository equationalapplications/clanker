import { UNREAD_STALENESS_ESCAPE_MS } from '../../constants/proactive'

describe('proactive constants', () => {
  it('mirrors the server staleness escape exactly', () => {
    // Mirrored from functions/src/services/proactiveWakeupGuardrails.ts. The
    // server stops counting a stale unread message; the client must stop
    // badging it at the same moment or the dot outlives the guardrail.
    expect(UNREAD_STALENESS_ESCAPE_MS).toBe(604_800_000)
  })
})
