# State Management Architecture

## Layer Overview

| Layer | Technology | Responsibility |
|---|---|---|
| Complex async flows | xState (machines) | Auth lifecycle, CRUD with optimistic rollback, multi-step flows |
| Server state / cache | TanStack Query + kvStorePersister | API data, background refetch, 24-hour offline cache |
| Local-first data | Expo SQLite | Messages, characters (always available offline) |
| Cross-cutting access | React Context (`GlobalStateContext`) | Exposes xState actor refs to the component tree |
| UI-local state | `useState` / `useEffect` | Transient UI state (modal visibility, form errors) |

---

## xState Machines

### Existing machines

| Machine | File | Responsibility |
|---|---|---|
| `authMachine` | `src/machines/authMachine.ts` | Firebase auth bootstrap, Cloud SQL user/subscription state, sign-out |
| `termsMachine` | `src/machines/termsMachine.ts` | Check and record Terms of Service acceptance |
| `characterMachine` | `src/machines/characterMachine.ts` | Character CRUD with optimistic updates and rollback |

### When to add a new machine

Create a new xState machine (following the `characterMachine` pattern) for any feature that has **two or more** of:

- Multiple sequential async steps (each can fail independently)
- Optimistic updates with a rollback path on failure
- Complex conditional transitions (e.g., guards that must be impossible to bypass)
- Long-running background work (e.g., polling, streaming, background sync)
- Explicit loading/idle/error/success states that need to be tested in isolation

Simple async operations that are one-shot (no optimistic update, no multi-step lifecycle) should use a
TanStack Query mutation instead. Rule of thumb: if you would draw a state diagram for it, use xState.

### How to add a new machine

1. **Create `src/machines/<feature>Machine.ts`** — model the states, context, and actors following the
   structure of `characterMachine.ts`.

2. **Register in `GlobalStateContext`** (`src/hooks/useMachines.ts`):
   ```ts
   export const GlobalStateContext = createContext<{
     authService: ActorRefFrom<typeof authMachine>
     termsService: ActorRefFrom<typeof termsMachine>
     characterService: ActorRefFrom<typeof characterMachine>
     myFeatureService: ActorRefFrom<typeof myFeatureMachine>  // ← add
   } | undefined>(undefined)

   export const useMyFeatureMachine = () => { /* same pattern */ }
   ```

3. **Spawn in `GlobalStateProvider`** (`app/_layout.tsx`):
   ```tsx
   const myFeatureService = useActorRef(myFeatureMachine)
   // add to context value:
   <GlobalStateContext.Provider value={{ ..., myFeatureService }}>
   ```

4. **Wire cross-machine events in `AppOrchestrator`** (`app/_layout.tsx`) if the new machine
   needs to react to auth changes or other machine transitions. Add the forwarding `useEffect`
   there, following the existing `USER_CHANGED` / `AUTH_STATE_CHANGED` patterns.

5. **Write tests in `__tests__/<feature>Machine.test.ts`** using `createActor` + `waitFor`
   from xstate, following the pattern in `__tests__/characterMachine.test.ts`.

---

## Inter-Machine Coordination (`AppOrchestrator`)

`GlobalStateProvider` in `app/_layout.tsx` creates and publishes the actor refs. All
cross-machine event forwarding is centralised in the nested `AppOrchestrator` component:

```
authMachine ──► USER_CHANGED (deduped by userId) ──────► characterMachine
           └──► AUTH_STATE_CHANGED (deduped by snapshot) ► termsMachine
```

`AppOrchestrator` uses direct `authService.subscribe(...)` subscriptions to observe the auth
machine and forward events. Deduplication is tracked via refs so that child machines only receive
events when the relevant slice of auth state actually changes.

**Why a component and not a rootMachine?** The coordination is intentionally kept as a thin React
component so that:
- The individual machines remain independently testable without a parent machine
- The wiring is visible in one place without xState-specific actor system APIs
- New machines are easy to add without restructuring the machine hierarchy

---

## `useCurrentPlan` — Deriving Plan Tier from authMachine

`useCurrentPlan` reads the subscription tier from `authMachine.context.subscription`,
which is populated from the `exchangeToken` bootstrap payload (`{ user, subscription }`).
It uses `useSelector` to react to auth machine updates and avoid extra auth/session listeners.

`isLoading` mirrors the same loading states used by navigation so plan-gated UI does not
flash incorrect state during initialization/sign-in/bootstrap.
