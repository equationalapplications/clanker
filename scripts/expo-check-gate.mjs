#!/usr/bin/env node

// Gate wrapper around `npx expo install --check` that applies the supply-chain
// SOP's 14-day age rule. `--check` compares package.json against the newest
// patch releases of the Expo SDK, so it fails within days of every Expo patch
// — while the SOP forbids adopting a release until it is >= 14 days old. Taken
// together the two make the step permanently red on a tree that is exactly
// where the SOP wants it.
//
// This runs `--check` and, when it reports packages off the SDK matrix, asks
// the registry whether any release satisfying the expected range is already
// >= 14 days old:
//   - yes -> the tree is genuinely behind an adoptable release: fail.
//   - no  -> every satisfying release is still inside the age window: warn
//            and pass. The step goes red again on its own once one ages in.
// Anything it cannot read or date fails closed (SOP: undeterminable age =
// fail-closed).
//
// Usage: node scripts/expo-check-gate.mjs

import { execFileSync, spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const MIN_AGE_DAYS = 14
const DAY_MS = 24 * 60 * 60 * 1000

// `expo install --check` lists each mismatch as
//   "  expo-router@57.0.25 - expected version: ~57.0.29"
const MISMATCH_LINE = /^\s*(@?[^@\s]+)@(\S+) - expected version: (\S+)\s*$/

export function parseMismatches(output) {
  const mismatches = []
  for (const line of output.split('\n')) {
    const match = line.match(MISMATCH_LINE)
    if (match) mismatches.push({ name: match[1], installed: match[2], expected: match[3] })
  }
  return mismatches
}

// Stable X.Y.Z only; prereleases (canaries, betas) never satisfy a gate range.
function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version)
  return match ? match.slice(1).map(Number) : null
}

function compare(a, b) {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2]
}

// The ranges `expo install` emits: `~X.Y.Z`, `^X.Y.Z` or an exact `X.Y.Z`.
// Anything else returns null so the caller fails closed.
export function rangeMatcher(range) {
  const match = /^([~^]?)(\d+\.\d+\.\d+)$/.exec(range)
  if (!match) return null
  const [op, base] = [match[1], parseVersion(match[2])]
  return (version) => {
    const v = parseVersion(version)
    if (!v || compare(v, base) < 0) return false
    if (op === '') return compare(v, base) === 0
    if (op === '~') return v[0] === base[0] && v[1] === base[1]
    // Caret: same major, or same minor below 1.0.0, or exact below 0.1.0.
    if (base[0] > 0) return v[0] === base[0]
    if (base[1] > 0) return v[0] === 0 && v[1] === base[1]
    return compare(v, base) === 0
  }
}

// Returns a satisfying release old enough to adopt, or the age of the oldest
// satisfying release (the first to age in), or why the age is undeterminable.
export function judge(expected, publishTimes, now = Date.now()) {
  const satisfies = rangeMatcher(expected)
  if (!satisfies) return { error: `unrecognized expected range ${expected}` }
  const candidates = Object.keys(publishTimes).filter(satisfies)
  if (candidates.length === 0) return { error: `no published release satisfies ${expected}` }
  let oldest = 0
  for (const version of candidates) {
    const published = Date.parse(publishTimes[version])
    if (Number.isNaN(published)) return { error: `no publish time for ${version}` }
    const ageDays = (now - published) / DAY_MS
    if (ageDays >= MIN_AGE_DAYS) return { adoptable: version, ageDays }
    oldest = Math.max(oldest, ageDays)
  }
  return { tooNew: true, ageDays: oldest }
}

function publishTimes(name) {
  const raw = execFileSync('npm', ['view', name, 'time', '--json'], { encoding: 'utf8' })
  return JSON.parse(raw)
}

function main() {
  const check = spawnSync('npx', ['expo', 'install', '--check'], { encoding: 'utf8' })
  const output = `${check.stdout ?? ''}${check.stderr ?? ''}`
  process.stdout.write(output)
  if (check.status === 0) {
    console.error('expo-check-gate: dependencies match the Expo SDK matrix')
    return 0
  }

  const mismatches = parseMismatches(output)
  if (mismatches.length === 0) {
    console.error(
      'expo-check-gate: `expo install --check` failed with no parseable mismatches — failing closed',
    )
    return 1
  }

  const failures = []
  for (const { name, installed, expected } of mismatches) {
    let verdict
    try {
      verdict = judge(expected, publishTimes(name))
    } catch (error) {
      verdict = { error: `registry lookup failed (${error.message.split('\n')[0]})` }
    }
    if (verdict.adoptable) {
      failures.push(
        `${name}@${installed}: ${verdict.adoptable} satisfies ${expected} and is ${Math.floor(verdict.ageDays)} days old`,
      )
    } else if (verdict.error) {
      failures.push(`${name}@${installed}: ${verdict.error} — failing closed`)
    } else {
      console.warn(
        `expo-check-gate: deferred ${name}@${installed} -> ${expected} (oldest satisfying release is ${Math.floor(verdict.ageDays)} days old, < ${MIN_AGE_DAYS})`,
      )
    }
  }

  if (failures.length > 0) {
    console.error(
      `expo-check-gate: ${failures.length} package(s) behind a release >= ${MIN_AGE_DAYS} days old:`,
    )
    for (const failure of failures) console.error(`  ${failure}`)
    return 1
  }
  console.error(`expo-check-gate: every mismatch is inside the ${MIN_AGE_DAYS}-day window`)
  return 0
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main())
