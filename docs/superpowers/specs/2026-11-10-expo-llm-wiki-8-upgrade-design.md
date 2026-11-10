# expo-llm-wiki 8.0.2 upgrade — design

Status: Implemented (this PR). Size: small change.

## Intent

Keep clanker on the current release of the first-party expo-llm-wiki monorepo. Move every
`@equationalapplications/*-llm-*` package from `^7.15.2` to `^8.0.2` in root, `cloud-agent`
and `functions`, without changing how character memory behaves for users.

## Goals

- All manifests name the installed version (`^8.0.2`); lockfiles move only first-party entries.
- Memory behaves exactly as on 7.15.2: background librarian and heal still run from `write()`.
- Survive the next upstream release, which renames the built-in Google Search tool entry.

## Non-goals

- Adopting 8.0's new maintenance model (`librarian.strategy: 'ops'`, `maintenance: 'deferred'`,
  host-driven `runPendingMaintenance()`). That is a behaviour change and gets its own design.
- Renaming clanker's own tool names (`wiki_get_ontology`, `wiki_traverse_graph`, …) to the
  library's new `ontology_get` / `graph_traverse`. Those names live in `shared/agent-tools-spec.ts`
  and cross the edge ↔ cloud wire to app versions already installed. 8.0.0 removing the
  library's deprecated manifests does not touch them: clanker imports only
  `getCurrentTimeManifest`, `escalateToCloudManifest`, `googleSearchManifest`,
  `buildAuthorizedToolsArray` and the `GeminiToolEntry` type from `core-llm-tools`.

## Anti-goals

- Memory silently stopping extracting facts after the upgrade. That is the 8.0.0 default
  unless the host opts out.

## What 7.15.2 → 8.0.2 changes for clanker

| Upstream change                                                                | Effect on clanker                                                                                                                                                            | Action                                                                                                                                                                       |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 8.0.0: `librarian.strategy` defaults to `'ops'`, `maintenance` to `'deferred'` | Would stop background librarian/heal; the `auto*Threshold` settings would do nothing                                                                                         | None needed. Staging already pins `{ strategy: 'legacy' }` + `'auto'` in `src/services/wikiService.ts` (`e9c3a30a`, 2026-11-09), asserted in `__tests__/wikiService.test.ts` |
| 8.0.0: deprecated `wiki_*` manifests removed from `core-llm-tools` (#324)      | None. Clanker doesn't import them                                                                                                                                            | None                                                                                                                                                                         |
| 7.17.0: new `graph_traverse` / `ontology_get` / `instructions_get` manifests   | Available, unused                                                                                                                                                            | None (non-goal)                                                                                                                                                              |
| Unreleased upstream #354: built-in entry key `google_search` → `googleSearch`  | `functions/src/generateReply.ts` `toGenAITool` checks `'google_search' in entry`; the no-tools fallback would throw `Unsupported tool entry`. TypeScript does not catch this | Accept both keys now; test added                                                                                                                                             |
| 7.16–8.0.2 other fixes (mcp-server, scopelab, docs)                            | Not used by clanker                                                                                                                                                          | None                                                                                                                                                                         |

`expo-llm-wiki` ships only `dist/` (no native code), so this is OTA-safe.

## Approaches

1. **Bump + keep 7.x behaviour (chosen).** Bump everything, rely on the existing pins, and make
   `toGenAITool` accept both keys. Smallest change; user-visible behaviour unchanged.
2. **Bump + adopt deferred maintenance.** Remove the pins and call `runPendingMaintenance()`
   from the app (e.g. on idle or app background). Matches upstream's direction, but changes
   when facts appear in memory and needs its own scheduling design and device testing.
3. **Wait for upstream #354, then bump.** Avoids the dual-key check, but holds the upgrade
   on an unreleased change for a one-line difference.

## Release-age gate

8.0.2 was published 2026-11-10, so `scripts/check-release-age.mjs` flags the eight
first-party lock entries (no third-party entry changes). Per the maintainer, first-party
`@equationalapplications/*` packages are exempt from the 14-day window; the script does not
encode that exemption today, so the CI step reports them.

## Left to the builder

- Re-check the `GeminiToolEntry` key when upstream #354 releases; drop the `google_search`
  branch only once clanker no longer pins any version that emits it.
