# Core LLM Tools Integration — Spec

**Date:** 2026-05-28
**Status:** Blocked on [`expo-llm-wiki` PR #39](https://github.com/equationalapplications/expo-llm-wiki/pull/39)
**Scope:** Replace hardcoded JSON schemas in `clanker-local-adk-sandbox` ADK tools with shared manifests from `@equationalapplications/core-llm-tools`

---

## 1. Problem

Tool schemas (name, description, parameters) are duplicated across consumers. The Edge Router and the Cloud Backend define the same `get_current_time` schema independently. When the description changes, every consumer must be updated. Drift causes behavioral inconsistency across platforms.

---

## 2. Architecture: Consumer B Pattern

```
┌─────────────────────────────────────┐
│  @equationalapplications/core-llm-tools  │
│  (owns: name, description, params)       │
└────────────────┬────────────────────┘
                 │  exports manifest
       ┌─────────┴──────────┐
       │                    │
Consumer A             Consumer B
Edge Router            Cloud Backend
(Claude/OpenAI)        (clanker-local-adk-sandbox)
spreads schema         spreads schema + attaches
into provider SDK      Node.js execute() logic
```

The core package owns the schema contract. Each consumer owns only its runtime execution.

---

## 3. Package Interface

`@equationalapplications/core-llm-tools` exports:

```typescript
interface AgentToolManifest {
  name: string;        // e.g. 'get_current_time'
  scope: AgentScope;   // e.g. 'core'
  schema: AgentToolSchema;
}

interface AgentToolSchema {
  name: string;
  description: string;
  parameters?: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export const getCurrentTimeManifest: AgentToolManifest;
export const escalateToCloudManifest: AgentToolManifest;
export function buildAuthorizedSchemaArray(
  manifests: AgentToolManifest[],
  userGrantedScopes: string[]
): AgentToolSchema[];
```

---

## 4. Consumer B Usage (clanker-local-adk-sandbox)

```typescript
import { FunctionTool } from '@google/adk';
import { getCurrentTimeManifest } from '@equationalapplications/core-llm-tools';

export const getCurrentTimeTool = new FunctionTool({
  ...(getCurrentTimeManifest.schema as any),
  execute: async (): Promise<string> => {
    return new Date().toLocaleString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    });
  },
});
```

The `as any` cast is required because `@google/adk`'s `FunctionTool` constructor expects a slightly different schema shape than `AgentToolSchema`. Runtime behavior is unaffected.

---

## 5. Design Decisions

### Pre-merge install strategy

PR #39 is not yet merged. Install from a local tarball until the package publishes to npm:

```bash
# In expo-llm-wiki/packages/core-llm-tools
npm pack  # produces core-llm-tools-0.1.0.tgz

# In clanker-local-adk-sandbox/functions
npm install ./core-llm-tools-0.1.0.tgz
```

After merge: remove tarball, `npm install @equationalapplications/core-llm-tools`, rebuild Docker.

### Output format change

`getCurrentTimeTool` currently returns `toISOString()` (UTC). After integration, it returns `toLocaleString('en-US', ...)`. This is intentional — ADK agents reason better on human-readable timestamps than ISO 8601.

### Type casting

`AgentToolSchema.parameters.type` is typed as `'object'` literal. `@google/adk` may expect a broader or different type at the constructor. Cast the spread to `any` at the call site rather than widening the shared type — keeps the core package strict.

---

## 6. Acceptance Criteria

| Test | Expected |
|------|----------|
| `getCurrentTimeTool.name` | `'get_current_time'` (inherited from manifest, not hardcoded) |
| `getCurrentTimeTool.execute({})` | Returns non-empty localized time string |
| TypeScript build | `tsc --noEmit` passes with no errors |
| Docker integration tests | All 5 tests pass inside container |

---

## 7. Files Changed (clanker-local-adk-sandbox)

| File | Change |
|------|--------|
| `functions/package.json` | Add `@equationalapplications/core-llm-tools` dependency |
| `functions/package-lock.json` | Updated lockfile |
| `functions/core-llm-tools-0.1.0.tgz` | Local tarball (pre-merge only, remove after publish) |
| `functions/src/tools/time.ts` | Spread `getCurrentTimeManifest.schema`; update execute() to localized string |
| `functions/tests/suite.ts` | Add Test 5: assert name inheritance + execute() returns string |

---

## 8. Phase 2 Preview

Once Phase 1 merges, migrate `search_memory` and `write_observation` schemas into the core package so both the Edge Router and Cloud Backend share memory tool contracts without duplication.
