# Core LLM Tools Integration — Spec

**Date:** 2026-05-28
**Status:** Implemented
**Scope:** Replace hardcoded JSON schemas in `equationalapplications/clanker` with shared manifests from `@equationalapplications/core-llm-tools` — both the Expo frontend and Firebase Functions backend

---

## 1. Problem

Tool schemas (name, description, parameters) are duplicated across consumers. The Edge Router and the Cloud Backend define the same `get_current_time` schema independently. When the description changes, every consumer must be updated. Drift causes behavioral inconsistency across platforms.

---

## 2. Architecture: Dual-Consumer Pattern

The `equationalapplications/clanker` repo acts as both consumers in the same monorepo.

```
┌─────────────────────────────────────────┐
│  @equationalapplications/core-llm-tools  │
│  (owns: name, description, params)       │
└────────────────┬────────────────────────┘
                 │  exports manifest
       ┌─────────┴──────────┐
       │                    │
Consumer A             Consumer B
Expo Edge Router       Firebase Functions
app/ (React Native)    functions/ (Node.js)
spreads schema         spreads schema + attaches
into provider SDK      @google/adk execute() logic
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

## 4. Consumer B Usage (functions/)

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

### Install strategy

PR #39 merged. Install from the registry in both consumers:

```bash
# Consumer A — Expo app (root)
npm install @equationalapplications/core-llm-tools

# Consumer B — Firebase Functions
cd functions && npm install @equationalapplications/core-llm-tools
```

### Output format change

`getCurrentTimeTool` uses `toLocaleString('en-US', ...)` rather than `toISOString()` (UTC). This is intentional — ADK agents reason better on human-readable timestamps than ISO 8601.

### Type casting

`AgentToolSchema.parameters.type` is typed as `'object'` literal. `@google/adk` may expect a broader or different type at the constructor. Cast the spread to `any` at the call site rather than widening the shared type — keeps the core package strict.

---

## 6. Acceptance Criteria

| Test | Expected |
|------|----------|
| `getCurrentTimeTool.name` | `'get_current_time'` (inherited from manifest, not hardcoded) |
| `getCurrentTimeTool.execute({})` | Returns non-empty localized time string |
| TypeScript build | `cd functions && npm run typecheck` passes with no errors |
| Functions test suite | `cd functions && npm test` passes with no failures |

---

## 7. Files Changed (equationalapplications/clanker)

| File | Change |
|------|--------|
| `package.json` | Add `@equationalapplications/core-llm-tools` dependency (Consumer A) |
| `package-lock.json` | Updated lockfile (root) |
| `functions/package.json` | Add `@equationalapplications/core-llm-tools` dependency (Consumer B) |
| `functions/package-lock.json` | Updated lockfile (functions) |
| `functions/src/tools/time.ts` | Spread `getCurrentTimeManifest.schema`; update execute() to localized string |
| `functions/src/tools/time.test.ts` | Assert name inherited from manifest + execute() returns non-empty string |

---

## 8. Phase 2 Preview

Once Phase 1 merges, migrate `search_memory` and `write_observation` schemas into the core package so both the Edge Router and Cloud Backend share memory tool contracts without duplication.
