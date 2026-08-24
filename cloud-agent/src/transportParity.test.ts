import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Read the SOURCE, not the build output: the invariant is about what future
// edits are allowed to write, and the compiled JS has no `z.object` left to find.
// With `rootDir: ".."` the test compiles to dist/cloud-agent/src/, so it sits
// three levels deep relative to the cloud-agent project root.
const SRC = join(import.meta.dirname, '..', '..', '..', 'src')
const httpHandler = readFileSync(join(SRC, 'index.ts'), 'utf8')
const wsHandler = readFileSync(join(SRC, 'handlers', 'wsAgentHandler.ts'), 'utf8')

for (const [name, source] of [
  ['http', httpHandler],
  ['ws', wsHandler],
] as const) {
  test(`${name} handler imports the shared agent-run schema`, () => {
    assert.match(
      source,
      /import \{[^}]*agentRunSchema[^}]*\} from '.*shared\/cloudAgentProtocol\.js'/,
    )
  })

  test(`${name} handler declares no agent-run schema of its own`, () => {
    assert.equal(/const\s+(agentRunSchema|contentSchema|attachmentSchema)\s*=/.test(source), false)
  })

  test(`${name} handler builds newMessage through buildNewMessage`, () => {
    assert.match(source, /newMessage: buildNewMessage\(/)
    // An inline parts literal is the exact regression this guards.
    assert.equal(/newMessage:\s*\{\s*role:/.test(source), false)
  })

  test(`${name} handler delivers the agent-image payload with matching keys`, () => {
    if (name === 'ws') {
      assert.match(source, /type:\s*'agent_image'/)
    } else {
      assert.match(source, /generatedImage:\s*result\.generatedImage \?\? null/)
    }
    // Both transports must carry the same two-field shape.
    assert.match(source, /imageBase64/)
    assert.match(source, /mimeType/)
  })
}
