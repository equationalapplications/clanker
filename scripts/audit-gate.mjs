#!/usr/bin/env node

// Gate wrapper around `npm audit` for advisories with no upstream fix. npm has
// no built-in ignore list, so a single unpatchable advisory (e.g. one flagged
// `*` vulnerable with no fixed version published) turns the audit gate red for
// every branch until upstream ships — with no way for an override to clear it.
//
// Reads `npm audit --json` output on stdin and exits non-zero when any
// high/critical finding traces to an advisory that is NOT explicitly
// allowlisted below. Allowlist entries must carry a reason and a removal
// condition; drop entries as soon as upstream publishes the fix.
//
// Usage: npm audit --omit=dev --json | node scripts/audit-gate.mjs

// Advisory -> why it is tolerated and when to remove the entry.
const ALLOWLIST = {
  // node-forge RSA PKCS#1 v1.5 signature verification accepts extra nested
  // DigestAlgorithm elements. Vulnerable range is `*` (last_affected 1.4.0 =
  // npm latest) — no patched release exists to override to. Reaches the tree
  // via expo → @expo/cli → @expo/code-signing-certificates (build/OTA signing
  // tooling); app.config.ts enables no code-signing verification, so the
  // vulnerable path is not exercised at app runtime. Remove when node-forge
  // publishes a fixed version.
  'GHSA-86w9-cpqp-85rv': {
    package: 'node-forge',
    reason: 'no patched release exists; build-time only path',
    added: '2026-10-02',
  },
}

const GITHUB_ADVISORY_URL = /GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}/i

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk) => (data += chunk))
    process.stdin.on('end', () => resolve(data))
    process.stdin.on('error', reject)
  })
}

const raw = await readStdin()
let report
try {
  report = JSON.parse(raw)
} catch {
  console.error('audit-gate: could not parse npm audit output — failing closed')
  process.exit(1)
}

const vulnerabilities = report.vulnerabilities ?? {}
const offenders = new Map()
const tolerated = new Set()

for (const [name, vuln] of Object.entries(vulnerabilities)) {
  const severity = vuln.severity
  if (severity !== 'high' && severity !== 'critical') continue
  for (const via of vuln.via ?? []) {
    if (typeof via === 'string') continue // "depends on vulnerable <pkg>" edge
    const id = (via.url?.match(GITHUB_ADVISORY_URL) ?? [])[0]
    if (!id) {
      offenders.set(id ?? via.title ?? name, { name, title: via.title })
      continue
    }
    if (ALLOWLIST[id]) tolerated.add(id)
    else offenders.set(id, { name, title: via.title })
  }
}

for (const [id, entry] of Object.entries(ALLOWLIST)) {
  if (tolerated.has(id)) {
    console.warn(`audit-gate: tolerated ${id} (${entry.package}) — ${entry.reason}`)
  } else {
    console.warn(`audit-gate: allowlist entry ${id} (${entry.package}) not hit by this audit`)
  }
}

if (offenders.size > 0) {
  console.error(`audit-gate: ${offenders.size} unallowlisted high/critical advisory(ies):`)
  for (const [id, { name, title }] of offenders) {
    console.error(`  - ${id} (${name}): ${title}`)
  }
  process.exit(1)
}

console.error('audit-gate: no unallowlisted high/critical advisories')
