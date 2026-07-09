# Character List Header — Overflow Menu Design

**Date:** 2026-07-09
**Status:** Implemented
**File affected:** `app/(drawer)/(tabs)/characters/list.tsx`

## Problem

The character list header renders a single row containing the title
`Characters` plus three actions: a `cloud-sync` `IconButton`, a contained
`New` button, and an outlined `From Bundle` button. On narrow mobile
devices the row is too crowded and the import button overflows off the
right edge of the screen.

## Goal

Restructure the header action row so it can never overflow, while keeping
the primary "create" action immediately visible and preserving all
existing behavior (cloud sync, bundle import, preview modal, toasts).

## Approach: Overflow (kebab) menu

Keep the header as one row:

```text
┌─────────────────────────────┐
│ Characters      [ + New ] ⋮ │
└─────────────────────────────┘
         menu ⋮:
           ☁ Cloud Sync
           ⭳ Import from Bundle
```

- Title `Characters` stays left.
- Primary `New` contained button stays visible (most common action,
  preserves discoverability).
- A `⋮` kebab `IconButton` opens a `react-native-paper` `Menu` anchored to
  the icon, containing the two secondary actions.

Worst-case header width = title + one button + one icon. Overflow is
structurally impossible.

## State management decision

Menu open/close and the busy indicator use plain `useState` — **not** an
xstate machine. The menu is ephemeral, local, synchronous UI with no async
transitions and no cross-component sharing; `react-native-paper`'s `Menu`
already owns show/hide. A machine here would add ceremony over a boolean
with zero behavioral benefit.

(See "Future work" — the pre-existing import/sync orchestration logic *is*
a reasonable machine candidate, but that is a separate refactor and out of
scope for this overflow fix.)

## Components

### Header row (`styles.headerActions`)

- Element 1: `New` — contained `Button`, `icon="plus"` (unchanged).
- Element 2: kebab — `IconButton` used as the `Menu` anchor.
- Existing `gap` retained. No `flexWrap`, no FAB, no second row.

### Menu

`react-native-paper` `Menu` component:

- `visible={menuVisible}`, `onDismiss={() => setMenuVisible(false)}`.
- `anchor` = the kebab `IconButton`.
- `Menu.Item` **Cloud Sync** — `leadingIcon="cloud-sync"`,
  `title="Cloud Sync"`.
- `Menu.Item` **Import from Bundle** — `leadingIcon="file-import-outline"`,
  `title="Import from Bundle"`.

Each `Menu.Item` `onPress` first closes the menu
(`setMenuVisible(false)`), then invokes the existing handler
(`handleCloudSync` / `handleCreateFromBundle`).

### Menu anchor positioning

The kebab `IconButton` is the `Menu` `anchor`. RNP menus can render
slightly over/under the header depending on the navigation setup and
platform. Verify placement on both Android and iOS; if the menu overlaps
the header row, set the `Menu` `statusBarHeight` prop (or an anchor offset)
to correct it. This is a manual-verification item, not a code default.

## State

- New local state: `const [menuVisible, setMenuVisible] = useState(false)`.
- Derived busy flag:
  `const isMenuBusy = isCloudSyncing || isImportParsing || isImporting || isCreatingClone`.

## Busy-state feedback (spinner on kebab)

When any menu-driven action is running, the kebab itself signals it — one
indicator covers all menu actions (a closed menu can't show per-item
state):

- `IconButton` props (RNP 5.15.3):
  - `icon="dots-vertical"` — keep a constant icon. Verified against
    `react-native-paper/src/components/IconButton/IconButton.tsx`: when
    `loading` is true the component renders an `ActivityIndicator` in place
    of the icon, so the icon value is simply ignored while busy. `icon` is
    a required prop; do **not** pass `undefined`.
  - `loading={isMenuBusy}`
  - `disabled={isMenuBusy || isPending || isCreatingDefault}`
- The `New` button keeps its own `loading`/`disabled`
  (`isPending || isCreatingDefault`) — unchanged.

### Immediate action feedback (transient toast)

Because the menu closes the instant an item is tapped, the only remaining
signal is the spinning kebab — the user can be left wondering what is
loading. To close that gap, fire an immediate transient `Snackbar` message
via the existing `setToastState` when a menu action starts:

- Cloud Sync → `"Syncing characters…"` on tap.
- Import from Bundle → `"Starting import…"` on tap.

These reuse the existing toast machinery (no new UI). They set expectation
immediately; the existing error/completion toasts still fire afterward.

## Accessibility

- Kebab `IconButton`: `accessibilityLabel="More actions"`.
- Menu items expose their titles as accessible labels
  (`Cloud Sync`, `Import from Bundle`) — restores the full label text that
  the previous icon-only cloud-sync button lacked.

## Unchanged

- `handleCloudSync`, `handleCreateFromBundle`, and all downstream handlers.
- Import preview `Modal` and its buttons.
- Cloud sync effects, import-error effect, error/completion toasts.
- `Snackbar` component itself (reused for the new transient start messages).
- `New` button behavior.

## Testing

- Existing `chatViewAccessibility` / list suites must still pass.
- Add coverage:
  - Tapping the kebab opens the menu; both items are present and reachable
    by accessibility label.
  - Selecting **Cloud Sync** closes the menu, shows a `"Syncing characters…"`
    toast, and triggers sync.
  - Selecting **Import from Bundle** closes the menu, shows a
    `"Starting import…"` toast, and starts the import pick/preview flow.
  - While `isMenuBusy` is true, the kebab shows its loading state and is
    disabled.

## Out of scope

- FAB pattern, wrapping layout, icon-only collapse (considered, rejected).
- Any change to the character card list, sync logic, or import logic.

## Future work (not this spec)

The import/sync orchestration in `list.tsx` (lines ~122–161) reconstructs
async transitions from booleans + refs (`clonedCharacterIdRef`,
`isCreatingClone`, `cloudSyncRequested`, `didEnterCloudSyncStateRef`, and
the sync-completion effect). That is a genuine xstate machine candidate —
`idle → parsing → preview → committing → done/error` with cancel-rollback —
and would remove the brittle ref/effect dance. Track as a separate refactor
with its own spec; do not fold into this overflow fix.
