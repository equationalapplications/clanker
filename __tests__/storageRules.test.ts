import { readFileSync } from 'fs'
import { join } from 'path'
const { SITE_BASE } = require('../src/config/siteConfig')

const rules = readFileSync(join(__dirname, '..', 'storage.rules'), 'utf8')
const firebaseJson = JSON.parse(readFileSync(join(__dirname, '..', 'firebase.json'), 'utf8'))
const cors = JSON.parse(readFileSync(join(__dirname, '..', 'cors.json'), 'utf8'))

describe('storage.rules', () => {
  it('scopes every path to the authenticated uid', () => {
    expect(rules).toContain('match /users/{uid}/{allPaths=**}')
    expect(rules).toContain('request.auth != null && request.auth.uid == uid')
  })

  it('admits only webp and jpeg on write', () => {
    expect(rules).toContain("request.resource.contentType in ['image/webp', 'image/jpeg']")
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

describe('cors.json', () => {
  // This config shipped allowing only the *.web.app / *.firebaseapp.com
  // fallback domains, so every browser upload from the real production origin
  // would have been blocked by CORS after an otherwise-correct deploy. Assert
  // against siteConfig — the declared single source of truth for the web
  // origin — so the two can never drift apart again.
  it('allows the canonical production web origin', () => {
    expect(cors[0].origin).toContain(SITE_BASE)
  })

  // uploadBytes is a multipart POST and deleteObject is a DELETE; a GET-only
  // config blocks browser uploads and cleanup deletes outright.
  it('allows the methods the web storage path actually issues', () => {
    for (const method of ['GET', 'POST', 'DELETE']) {
      expect(cors[0].method).toContain(method)
    }
  })

  // GCS returns responseHeader as Access-Control-Allow-Headers on the
  // preflight, so an authenticated upload fails unless Authorization and the
  // resumable-upload headers are admitted.
  it('admits the headers the Firebase JS SDK sends on an authenticated upload', () => {
    expect(cors[0].responseHeader).toContain('Content-Type')
    expect(cors[0].responseHeader).toContain('Authorization')
  })
})