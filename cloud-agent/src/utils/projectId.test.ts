import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveProjectId } from './projectId.js'

const PROJECT_ENV_KEYS = ['GCLOUD_PROJECT', 'GCP_PROJECT', 'GOOGLE_CLOUD_PROJECT'] as const

type SavedEnv = Partial<Record<(typeof PROJECT_ENV_KEYS)[number], string | undefined>>

function snapshotProjectEnv(): SavedEnv {
  const snap: SavedEnv = {}
  for (const k of PROJECT_ENV_KEYS) snap[k] = process.env[k]
  return snap
}

function restoreProjectEnv(snap: SavedEnv): void {
  for (const k of PROJECT_ENV_KEYS) {
    if (snap[k] === undefined) delete process.env[k]
    else process.env[k] = snap[k]
  }
}

test('resolveProjectId returns the project when only GOOGLE_CLOUD_PROJECT is set', () => {
  const snap = snapshotProjectEnv()
  try {
    delete process.env.GCLOUD_PROJECT
    delete process.env.GCP_PROJECT
    process.env.GOOGLE_CLOUD_PROJECT = 'clanker-prod'
    assert.equal(resolveProjectId(), 'clanker-prod')
  } finally {
    restoreProjectEnv(snap)
  }
})

test('resolveProjectId falls back to GCLOUD_PROJECT, then GCP_PROJECT', () => {
  const snap = snapshotProjectEnv()
  try {
    delete process.env.GOOGLE_CLOUD_PROJECT
    process.env.GCLOUD_PROJECT = 'from-gcloud'
    delete process.env.GCP_PROJECT
    assert.equal(resolveProjectId(), 'from-gcloud')

    delete process.env.GCLOUD_PROJECT
    process.env.GCP_PROJECT = 'from-gcp'
    assert.equal(resolveProjectId(), 'from-gcp')
  } finally {
    restoreProjectEnv(snap)
  }
})

test('resolveProjectId prefers GCLOUD_PROJECT over GCP_PROJECT over GOOGLE_CLOUD_PROJECT', () => {
  // Priority order was previously only exercised via fallback paths, so a
  // reordering of the candidate list would not have failed any test.
  const snap = snapshotProjectEnv()
  try {
    process.env.GCLOUD_PROJECT = 'first'
    process.env.GCP_PROJECT = 'second'
    process.env.GOOGLE_CLOUD_PROJECT = 'third'
    assert.equal(resolveProjectId(), 'first')

    delete process.env.GCLOUD_PROJECT
    assert.equal(resolveProjectId(), 'second')
  } finally {
    restoreProjectEnv(snap)
  }
})

test('resolveProjectId returns undefined when no project env is set', () => {
  const snap = snapshotProjectEnv()
  try {
    for (const k of PROJECT_ENV_KEYS) delete process.env[k]
    assert.equal(resolveProjectId(), undefined)
  } finally {
    restoreProjectEnv(snap)
  }
})

test('resolveProjectId trims surrounding whitespace', () => {
  const snap = snapshotProjectEnv()
  try {
    delete process.env.GCLOUD_PROJECT
    delete process.env.GCP_PROJECT
    process.env.GOOGLE_CLOUD_PROJECT = '  clanker-prod  '
    assert.equal(resolveProjectId(), 'clanker-prod')
  } finally {
    restoreProjectEnv(snap)
  }
})

test('resolveProjectId falls through whitespace-only higher-priority vars', () => {
  // A stray "  " in GCLOUD_PROJECT (e.g. from an unset CI variable that
  // exports as empty space) must not short-circuit the chain — the next
  // valid candidate wins. Pre-fix, ?? returned the whitespace and the
  // trailing .trim() produced "", which made the caller throw
  // MISSING_GCP_PROJECT even though GCP_PROJECT was usable.
  const snap = snapshotProjectEnv()
  try {
    process.env.GCLOUD_PROJECT = '   '
    delete process.env.GCP_PROJECT
    process.env.GOOGLE_CLOUD_PROJECT = 'clanker-prod'
    assert.equal(resolveProjectId(), 'clanker-prod')

    process.env.GCLOUD_PROJECT = ''
    process.env.GCP_PROJECT = '\t\n'
    assert.equal(resolveProjectId(), 'clanker-prod')

    process.env.GCLOUD_PROJECT = '   '
    process.env.GCP_PROJECT = '  '
    delete process.env.GOOGLE_CLOUD_PROJECT
    assert.equal(resolveProjectId(), undefined)
  } finally {
    restoreProjectEnv(snap)
  }
})
