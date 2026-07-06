import { fixtureChecksum, loadOkfFixture } from './okfFixtures'

// Vendored from expo-llm-wiki packages/okf/fixtures (profile doc §9: non-source
// copies are checksummed so silent drift between repos fails loudly). When the
// upstream fixtures change intentionally, re-copy and update these values.
const GOLDEN_V1_SHA256 = '5ec625e217df61a862f99b81187dfa5735a331bf193b319c9dc60966f93a48f8'
const LEGACY_PROFILE_0_SHA256 = '6fa609d070106416c8b4e2797084ea1555cb8a02bc56d34c5c344c9e87922c10'

describe('vendored OKF fixtures', () => {
  it('golden-v1 matches the recorded checksum', () => {
    expect(fixtureChecksum('golden-v1')).toBe(GOLDEN_V1_SHA256)
  })

  it('legacy-profile-0 matches the recorded checksum', () => {
    expect(fixtureChecksum('legacy-profile-0')).toBe(LEGACY_PROFILE_0_SHA256)
  })

  it('golden-v1 root index carries the profile key', () => {
    const root = loadOkfFixture('golden-v1').find((f) => f.path === 'index.md')!
    expect(root.content).toMatch(/^profile:\s*llm-wiki\/1\s*$/m)
  })

  it('legacy-profile-0 root index has no profile key', () => {
    const root = loadOkfFixture('legacy-profile-0').find((f) => f.path === 'index.md')!
    expect(root.content).not.toContain('profile:')
  })
})
