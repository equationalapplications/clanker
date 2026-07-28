import { readFileSync } from 'fs'
import { join } from 'path'

const rules = readFileSync(join(__dirname, '..', 'storage.rules'), 'utf8')
const firebaseJson = JSON.parse(readFileSync(join(__dirname, '..', 'firebase.json'), 'utf8'))

describe('storage.rules', () => {
  it('scopes every path to the authenticated uid', () => {
    expect(rules).toContain('match /users/{uid}/{allPaths=**}')
    expect(rules).toContain('request.auth != null && request.auth.uid == uid')
  })

  it('admits only webp and jpeg on write', () => {
    expect(rules).toContain("request.resource.contentType.matches('image/webp')")
    expect(rules).toContain("request.resource.contentType.matches('image/jpeg')")
  })

  it('caps uploads at 2 MB', () => {
    expect(rules).toContain('request.resource.size < 2 * 1024 * 1024')
  })

  it('has no public-read path — sharing goes through signed URLs', () => {
    expect(rules).not.toMatch(/allow read:\s*if true/)
  })

  it('denies everything outside users/', () => {
    expect(rules).toContain('match /{path=**}')
    expect(rules).toContain('allow read, write: if false')
  })
})

describe('firebase.json', () => {
  it('registers the storage rules file', () => {
    expect(firebaseJson.storage).toEqual({ rules: 'storage.rules' })
  })
})