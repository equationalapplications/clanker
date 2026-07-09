# Character List Header Overflow Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the character-list header action row from overflowing on narrow devices by collapsing Cloud Sync + Import from Bundle into a kebab overflow menu, keeping `New` visible.

**Architecture:** Single-screen UI change in `app/(drawer)/(tabs)/characters/list.tsx`. Replace the two secondary header buttons with a `react-native-paper` `Menu` anchored to a `⋮` `IconButton`. Menu open state is a local `useState` boolean (no state machine). A derived `isMenuBusy` flag drives a spinner on the kebab; a transient `Snackbar` message fires the moment a menu action starts. All existing handlers, effects, and the import preview modal are untouched.

**Tech Stack:** React Native, react-native-paper 5.15.3, expo-router, xstate/@xstate/react, Jest + react-test-renderer.

**Spec:** `docs/superpowers/specs/2026-07-09-character-list-header-overflow-menu-design.md`

---

## File Structure

- **Modify:** `app/(drawer)/(tabs)/characters/list.tsx`
  - Add `Menu` to the `react-native-paper` import.
  - Add `menuVisible` state + `isMenuBusy` derived flag.
  - Add two menu-action wrappers (`handleMenuCloudSync`, `handleMenuImport`) that close the menu, fire a transient toast, then call the existing handlers.
  - Replace the `cloud-sync` `IconButton` + `From Bundle` `Button` in `headerActions` with a `Menu` whose anchor is a `dots-vertical` `IconButton`.
- **Create:** `__tests__/charactersListHeaderMenu.test.tsx`
  - Render test (react-test-renderer) verifying the kebab opens the menu, items are present by title, selecting each closes the menu + fires sync/import + toast, and the kebab is disabled while busy.

The `New` button, import preview `Modal`, all sync/import effects, and `styles` are unchanged (except no style edit is needed — the row already uses `gap`).

---

## Task 1: Failing test for the overflow menu

**Files:**
- Test: `__tests__/charactersListHeaderMenu.test.tsx` (create)

- [ ] **Step 1: Write the failing test**

Create `__tests__/charactersListHeaderMenu.test.tsx`:

```tsx
import React from 'react'
import renderer, { act } from 'react-test-renderer'

// ---- react-native ----
jest.mock('react-native', () => {
  const React = require('react')
  return {
    View: ({ children, ...props }: any) => React.createElement('View', props, children),
    StyleSheet: { create: (s: any) => s },
    FlatList: ({ data = [], renderItem, ListEmptyComponent }: any) =>
      React.createElement(
        'FlatList',
        null,
        data.length
          ? data.map((item: any, i: number) =>
              React.createElement('Row', { key: i }, renderItem({ item })),
            )
          : ListEmptyComponent ?? null,
      ),
  }
})

// ---- react-native-paper (Menu mock renders items only when visible) ----
jest.mock('react-native-paper', () => {
  const React = require('react')
  return {
    Text: ({ children }: any) => React.createElement('Text', null, children),
    Button: ({ children, disabled, onPress }: any) =>
      React.createElement('Button', { disabled, onPress }, children),
    ActivityIndicator: () => null,
    Snackbar: ({ visible, children }: any) =>
      visible ? React.createElement('Snackbar', null, children) : null,
    IconButton: ({ icon, onPress, disabled, loading, accessibilityLabel }: any) =>
      React.createElement('IconButton', {
        icon,
        onPress,
        disabled,
        loading,
        accessibilityLabel,
      }),
    Portal: ({ children }: any) => React.createElement('Portal', null, children),
    Modal: ({ visible, children }: any) =>
      visible ? React.createElement('Modal', null, children) : null,
    useTheme: () => ({ colors: { surface: '#fff' } }),
    Menu: Object.assign(
      ({ visible, children, anchor }: any) =>
        React.createElement('Menu', { visible }, anchor, visible ? children : null),
      {
        Item: ({ title, onPress }: any) =>
          React.createElement('MenuItem', { onPress, title }, title),
      },
    ),
  }
})

// ---- expo-router ----
jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
}))

// ---- @xstate/react: run the selector against the actor snapshot ----
jest.mock('@xstate/react', () => ({
  useSelector: (actor: any, selector: any) => selector(actor.getSnapshot()),
}))

// ---- machines ----
jest.mock('~/hooks/useMachines', () => ({
  useCharacterMachine: () => ({
    send: jest.fn(),
    getSnapshot: () => ({ matches: () => false }),
  }),
  useAuthMachine: () => ({
    send: jest.fn(),
    getSnapshot: () => ({ context: { user: { uid: 'user-1' } } }),
  }),
}))

// ---- character hooks (mutable per test) ----
const mockSync = jest.fn()
const mockCreate = jest.fn()
let mockIsCloudSyncing = false
jest.mock('~/hooks/useCharacters', () => ({
  useCharacters: () => ({ characters: [], isLoading: false }),
  useCreateCharacter: () => ({ create: mockCreate, isPending: false, pendingCharacterId: null }),
  useSyncCharacters: () => ({ sync: mockSync, isCloudSyncing: mockIsCloudSyncing, error: null }),
}))

// ---- import hook ----
const mockPickAndPreview = jest.fn()
jest.mock('~/hooks/useImportCharacterOKF', () => ({
  useImportCharacterOKF: () => ({
    preview: null,
    isParsing: false,
    isImporting: false,
    error: null,
    handlePickAndPreview: mockPickAndPreview,
    handleCommitImport: jest.fn(),
    handleCancel: jest.fn(),
  }),
}))

// ---- misc deps ----
jest.mock('~/components/CharacterCard', () => ({ CharacterCard: () => null }))
jest.mock('~/database/characterDatabase', () => ({ createCharacter: jest.fn() }))
jest.mock('~/services/characterService', () => ({ deleteCharacter: jest.fn() }))
jest.mock('~/utilities/reportError', () => ({ reportError: jest.fn() }))

import CharactersListScreen from '../app/(drawer)/(tabs)/characters/list'

// Test helpers -------------------------------------------------------------

type El = renderer.ReactTestInstance

function findByType(root: El, type: string): El[] {
  return root.findAll((n) => n.type === type)
}

function kebab(root: El): El {
  return findByType(root, 'IconButton').find(
    (n) => n.props.accessibilityLabel === 'More actions',
  )!
}

function menuItems(root: El): El[] {
  return findByType(root, 'MenuItem')
}

beforeEach(() => {
  jest.clearAllMocks()
  mockIsCloudSyncing = false
})

describe('CharactersListScreen header overflow menu', () => {
  it('renders a kebab that opens a menu with Cloud Sync and Import items', () => {
    const tree = renderer.create(<CharactersListScreen />)
    const root = tree.root

    // Menu closed initially -> no items rendered.
    expect(menuItems(root)).toHaveLength(0)

    act(() => {
      kebab(root).props.onPress()
    })

    const titles = menuItems(root).map((n) => n.props.title)
    expect(titles).toEqual(['Cloud Sync', 'Import from Bundle'])
  })

  it('Cloud Sync item closes the menu, shows a toast, and triggers sync', () => {
    const tree = renderer.create(<CharactersListScreen />)
    const root = tree.root

    act(() => kebab(root).props.onPress())
    const cloudSync = menuItems(root).find((n) => n.props.title === 'Cloud Sync')!
    act(() => cloudSync.props.onPress())

    expect(mockSync).toHaveBeenCalledTimes(1)
    expect(menuItems(root)).toHaveLength(0) // menu closed
    const snackbar = findByType(root, 'Snackbar')[0]
    expect(snackbar).toBeTruthy()
  })

  it('Import item closes the menu, shows a toast, and starts the import flow', () => {
    const tree = renderer.create(<CharactersListScreen />)
    const root = tree.root

    act(() => kebab(root).props.onPress())
    const importItem = menuItems(root).find((n) => n.props.title === 'Import from Bundle')!
    act(() => importItem.props.onPress())

    expect(mockPickAndPreview).toHaveBeenCalledTimes(1)
    expect(findByType(root, 'Snackbar')[0]).toBeTruthy()
  })

  it('disables the kebab and shows its loading state while syncing', () => {
    mockIsCloudSyncing = true
    const tree = renderer.create(<CharactersListScreen />)
    const k = kebab(tree.root)
    expect(k.props.disabled).toBe(true)
    expect(k.props.loading).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- __tests__/charactersListHeaderMenu.test.tsx`
Expected: FAIL — the current screen renders a `cloud-sync` `IconButton` (accessibilityLabel `"Cloud Sync"`, not `"More actions"`) and no `Menu`, so `kebab(root)` is `undefined` and `.props.onPress()` throws / assertions fail.

(The `test` script wraps `jest` with a preload; args after `--` pass through to jest.)

- [ ] **Step 3: Commit the failing test**

```bash
git add __tests__/charactersListHeaderMenu.test.tsx
git commit -m "test: failing spec for character list header overflow menu"
```

---

## Task 2: Implement the overflow menu

**Files:**
- Modify: `app/(drawer)/(tabs)/characters/list.tsx`

- [ ] **Step 1: Add `Menu` to the paper import**

Change line 2 from:

```tsx
import { Text, Button, ActivityIndicator, Snackbar, IconButton, Portal, Modal, useTheme } from 'react-native-paper'
```

to:

```tsx
import { Text, Button, ActivityIndicator, Snackbar, IconButton, Portal, Modal, Menu, useTheme } from 'react-native-paper'
```

- [ ] **Step 2: Add menu state, busy flag, and action wrappers**

In the component body, immediately after the `const [isCreatingClone, setIsCreatingClone] = useState(false)` / `clonedCharacterIdRef` declarations (around line 46), add:

```tsx
  const [menuVisible, setMenuVisible] = useState(false)
  const isMenuBusy = isCloudSyncing || isImportParsing || isImporting || isCreatingClone

  const handleMenuCloudSync = () => {
    setMenuVisible(false)
    if (isCloudSyncing || isPending || isCreatingDefault) {
      return
    }
    setToastState({ message: 'Syncing characters…', requiresSubscription: false })
    handleCloudSync()
  }

  const handleMenuImport = () => {
    setMenuVisible(false)
    setToastState({ message: 'Starting import…', requiresSubscription: false })
    handleCreateFromBundle()
  }
```

(`handleCloudSync` and `handleCreateFromBundle` are already defined earlier in the component; these wrappers reuse them.)

- [ ] **Step 3: Replace the header actions block**

Replace the entire `headerActions` `View` (currently lines ~178–210, the `cloud-sync` `IconButton` + `New` `Button` + `From Bundle` `Button`) with:

```tsx
        <View style={styles.headerActions}>
          <Button
            mode="contained"
            icon="plus"
            onPress={handleCreateCharacter}
            loading={isPending || isCreatingDefault}
            disabled={isPending || isCreatingDefault}
          >
            New
          </Button>
          <Menu
            visible={menuVisible}
            onDismiss={() => setMenuVisible(false)}
            anchor={
              <IconButton
                icon="dots-vertical"
                size={28}
                onPress={() => setMenuVisible(true)}
                loading={isMenuBusy}
                disabled={isMenuBusy || isPending || isCreatingDefault}
                accessibilityLabel="More actions"
              />
            }
          >
            <Menu.Item
              leadingIcon="cloud-sync"
              onPress={handleMenuCloudSync}
              title="Cloud Sync"
            />
            <Menu.Item
              leadingIcon="file-import-outline"
              onPress={handleMenuImport}
              title="Import from Bundle"
            />
          </Menu>
        </View>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- __tests__/charactersListHeaderMenu.test.tsx`
Expected: PASS (all 4 tests green).

- [ ] **Step 5: Typecheck and lint the changed file**

Run: `npm run typecheck` and `npm run lint`
Expected: no new errors in `list.tsx` or the test.

- [ ] **Step 6: Commit**

```bash
git add app/\(drawer\)/\(tabs\)/characters/list.tsx
git commit -m "feat: collapse character list header actions into overflow menu"
```

---

## Task 3: Guard against regressions in the existing suite

**Files:**
- (No new files — run the existing related suites.)

- [ ] **Step 1: Run the character/accessibility suites**

Run: `npm test -- __tests__/chatViewAccessibility.test.tsx __tests__/characterCardAccessibility.test.tsx __tests__/editCharacterScreen.test.tsx`
Expected: PASS. These do not import `list.tsx`, but they exercise shared components and confirm nothing shared broke.

- [ ] **Step 2: Run the full unit suite**

Run: `npm test`
Expected: PASS (or only pre-existing unrelated failures — note any that were already failing before this change).

- [ ] **Step 3: Commit only if a fix was required**

If a shared change was needed, commit it:

```bash
git add -A
git commit -m "test: keep existing suites green after overflow menu change"
```

Otherwise skip — nothing to commit.

---

## Task 4: Manual device verification

**Files:** none (manual QA — the spec calls this out explicitly).

- [ ] **Step 1: Verify no overflow on a narrow device**

Run the app (Expo dev client / simulator at a small width, e.g. iPhone SE). Open the Characters tab. Confirm the header shows `Characters`, a `New` button, and a `⋮` kebab — nothing clipped off the right edge.

- [ ] **Step 2: Verify menu anchor positioning on both platforms**

Open the kebab menu on iOS and Android. Confirm the menu does not render over/under the header row. If it overlaps, set the `Menu` `statusBarHeight` prop (or an anchor offset) as noted in the spec, then re-run Task 1's test to confirm it still passes and commit the tweak.

- [ ] **Step 3: Verify busy feedback**

Tap **Cloud Sync**: confirm the `"Syncing characters…"` toast appears immediately and the kebab shows a spinner + is disabled until sync completes. Tap **Import from Bundle**: confirm the `"Starting import…"` toast appears and the file picker / preview flow starts.

---

## Self-Review Notes

- **Spec coverage:** overflow menu (Task 2 Step 3), `New` stays visible (Task 2 Step 3), `useState` not a machine (Task 2 Step 2), kebab spinner via `loading`/`disabled` (Task 2 Step 3, Task 1 test 4), transient start toasts (Task 2 Step 2, Task 1 tests 2–3), accessibility label `"More actions"` + item titles (Task 2 Step 3, Task 1 test 1), menu-anchor manual check (Task 4 Step 2), unchanged handlers/modal/effects (no edits to those lines). All covered.
- **IconButton `loading`:** verified in `react-native-paper/src/components/IconButton/IconButton.tsx` (5.15.3) — `loading` renders an `ActivityIndicator` in place of the icon, so `icon="dots-vertical"` stays constant and is ignored while busy. No `undefined`.
- **Naming consistency:** `menuVisible`/`setMenuVisible`, `isMenuBusy`, `handleMenuCloudSync`, `handleMenuImport` used identically in the implementation and referenced by behavior in the test.
