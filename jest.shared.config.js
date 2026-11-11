const fs = require('node:fs')
const path = require('node:path')

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.worktrees',
  '.brain',
  '.claude',
  '.fastembed_cache',
  'functions',
  'cloud-agent',
  'extension',
  'android',
  'ios',
  'build',
  'dist',
  'coverage',
  'temp',
])

const TRANSFORM_IGNORE_PATTERNS = [
  'node_modules/(?!((jest-)?react-native|@react-native(-community)?|@react-native-firebase/.*|firebase/.*|@firebase/.*)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg)',
]

// Suites that declare `@jest-environment jsdom` run in the 'dom' project
// (jsdom environment); everything else runs in 'native'. The docblock stays
// the single source of truth for project membership — discovered at config
// load so a new suite never has to be listed here.
//
// WHY the split: since SDK 58 (RN 0.88) the jest preset is the external
// @react-native/jest-preset, whose setup file unconditionally does
// `Object.defineProperties(global, { window: ... })`. jsdom installs `window`
// as a non-configurable global, so that define throws and the suite cannot
// even load. `patches/@react-native+jest-preset+0.88.1.patch` (patch-package)
// removes that window entry — with it applied the stock setup is jsdom-safe
// (jest-expo's own setup guards `window` with `typeof window !== 'object'`),
// so both projects share the same preset and only the environment differs.
function findJsdomSuitesAbs(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue
      findJsdomSuitesAbs(path.join(dir, entry.name), out)
      continue
    }
    if (!/\.(test|spec)\.[jt]sx?$/.test(entry.name)) continue
    const file = path.join(dir, entry.name)
    let head = ''
    try {
      const fd = fs.openSync(file, 'r')
      const buf = Buffer.alloc(512)
      const bytes = fs.readSync(fd, buf, 0, 512, 0)
      fs.closeSync(fd)
      head = buf.toString('utf8', 0, bytes)
    } catch {
      continue
    }
    if (/@jest-environment\s+jsdom/.test(head)) out.push(file)
  }
  return out
}

function findJsdomSuitesRel(rootDir) {
  return findJsdomSuitesAbs(rootDir, [])
    .map((f) => f.slice(rootDir.length + 1).replace(/\\/g, '/'))
    .sort()
}

module.exports = { TRANSFORM_IGNORE_PATTERNS, findJsdomSuites: findJsdomSuitesRel, IGNORED_DIRS }
