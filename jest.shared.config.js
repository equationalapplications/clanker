const fs = require('node:fs')
const path = require('node:path')
const { extract, parse } = require('jest-docblock')

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
  'node_modules/(?!((jest-)?react-native|@react-native(-community)?|@react-native-firebase/.*|firebase/.*|@firebase/.*)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|@equationalapplications/expo-two-way-audio)',
]

// Suites that declare `@jest-environment jsdom` run in the 'dom' project
// (jsdom environment); everything else runs in 'native'. The docblock stays
// the single source of truth for project membership — discovered at config
// load so a new suite never has to be listed here. Classification is Jest's
// own docblock rule (jest-docblock extract/parse of the whole file); there is
// no regex fallback, so discovery cannot disagree with the runner.
//
// Depth rule: node_modules, .git and .worktrees are pruned at any depth; the
// rest of IGNORED_DIRS (build, dist, ...) only at the repo root, so a nested
// `src/x/build/__tests__` suite is still discovered.
//
// WHY the split: since SDK 58 (RN 0.88) the jest preset is the external
// @react-native/jest-preset, whose setup file unconditionally does
// `Object.defineProperties(global, { window: ... })`. jsdom installs `window`
// as a non-configurable global, so that define throws and the suite cannot
// even load. `patches/@react-native+jest-preset+0.88.1.patch` (patch-package)
// removes that window entry — with it applied the stock setup is jsdom-safe
// (jest-expo's own setup guards `window` with `typeof window !== 'object'`),
// so both projects share the same preset and only the environment differs.
const ALWAYS_PRUNED = new Set(['node_modules', '.git', '.worktrees'])

// Jest resolves `@jest-environment <name>` by trying `jest-environment-<name>`
// first, so the long form selects the same environment and must classify the same.
const JSDOM_ENVIRONMENTS = new Set(['jsdom', 'jest-environment-jsdom'])

function isJsdomSource(source) {
  return JSDOM_ENVIRONMENTS.has(parse(extract(source))['jest-environment'])
}

function findJsdomSuitesAbs(dir, out, depth) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (ALWAYS_PRUNED.has(entry.name)) continue
      if (depth === 0 && IGNORED_DIRS.has(entry.name)) continue
      findJsdomSuitesAbs(path.join(dir, entry.name), out, depth + 1)
      continue
    }
    if (!/\.(test|spec)\.[jt]sx?$/.test(entry.name)) continue
    const file = path.join(dir, entry.name)
    let source
    try {
      source = fs.readFileSync(file, 'utf8')
    } catch {
      continue
    }
    if (isJsdomSource(source)) out.push(file)
  }
  return out
}

function findJsdomSuitesRel(rootDir) {
  return findJsdomSuitesAbs(rootDir, [], 0)
    .map((f) => f.slice(rootDir.length + 1).replace(/\\/g, '/'))
    .sort()
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function jsdomSuitePattern(rootDir, relPath) {
  return '^' + escapeRegExp(path.join(rootDir, relPath)) + '$'
}

// Jest treats an empty testRegex as unset and falls back to the default
// testMatch, which would run EVERY suite in the dom project. A never-matching
// pattern keeps the dom project empty when no suite declares jsdom.
function domTestRegex(rootDir, suites) {
  return suites.length ? suites.map((f) => jsdomSuitePattern(rootDir, f)) : ['(?!)']
}

module.exports = {
  TRANSFORM_IGNORE_PATTERNS,
  findJsdomSuites: findJsdomSuitesRel,
  IGNORED_DIRS,
  isJsdomSource,
  escapeRegExp,
  jsdomSuitePattern,
  domTestRegex,
}
