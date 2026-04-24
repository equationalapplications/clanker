# Web Debugging in VS Code

How to debug the Expo web app locally using VS Code's integrated browser tools (GitHub Copilot agent).

---

## Quick Start: Live Debug Session

1. **Start Metro** in a terminal:
   ```bash
   npx expo start --web --port 8081
   ```
   Wait for `Web: http://localhost:8081` to appear and the initial bundle to complete.

2. **Open the browser** via the Copilot agent's browser tool (or navigate to `http://localhost:8081` in Chrome/Edge).

3. **Simulate a fresh user** (no localStorage consent, etc.) by clearing storage before testing:
   ```js
   // In the browser console or via Playwright:
   window.localStorage.clear()
   location.reload()
   ```

4. **Capture all errors and warnings** programmatically with Playwright inside the Copilot agent:
   ```js
   const errors = []
   page.on('pageerror', err => errors.push({ text: err.message, stack: err.stack }))
   page.on('console', msg => {
     if (msg.type() === 'warning' || msg.type() === 'error')
       errors.push({ type: msg.type(), text: msg.text(), location: msg.location() })
   })
   await page.evaluate(() => window.localStorage.clear())
   await page.reload()
   await page.waitForTimeout(4000)
   return errors
   ```

   The agent's `run_playwright_code` tool supports this pattern and returns structured output, making it far faster than reading raw browser logs.

---

## React Native Web Style Pitfalls (and how to find them)

The site-crashing `TypeError: Failed to set an indexed property [0] on 'CSSStyleDeclaration': Indexed property setter is not supported` and related `useNativeDriver` warnings all trace back to a small set of React Native Web patterns that work fine in native but fail on web.

### 1. Style arrays passed through `<Link asChild>` / Expo Router `<Slot>`

**Symptom:** `[expo-router]: You are passing an array of styles to a child of <Slot>` — crashes in dev overlay, manifests as `CSSStyleDeclaration` indexed setter error in production.

**Root cause:** Expo Router's `<Link asChild>` uses `<Slot>` to clone its child with merged props. `<Slot>` throws if the child's `style` prop is an array (a `StyleSheet` numeric ID mixed with an inline object).

**Fix:** Pre-compute a flat style object before passing it to any `<Link asChild>` child:
```tsx
// ❌ Crashes
<Link href="/terms" asChild>
  <Text style={[styles.link, { color: colors.outline }]}>Terms</Text>
</Link>

// ✅ Safe
const linkStyle = StyleSheet.flatten([styles.link, { color: colors.outline }])
<Link href="/terms" asChild>
  <Text style={linkStyle}>Terms</Text>
</Link>
```

### 2. `gap` in `StyleSheet.create`

**Symptom:** Same `CSSStyleDeclaration` indexed setter error.

**Root cause:** React Native Web translates `gap` using indexed CSS property assignment (`style[0] = value`), which Chrome now rejects.

**Fix:** Replace `gap` with `columnGap` and `rowGap`:
```tsx
// ❌
row: { flexDirection: 'row', gap: 8 }

// ✅
row: { flexDirection: 'row', columnGap: 8, rowGap: 8 }
```

### 3. Mixed `StyleSheet` IDs and inline objects in style arrays on web

**Symptom:** Same `CSSStyleDeclaration` crash on any component where a `StyleSheet.create` ID is combined with a dynamic inline style.

**Root cause:** React Native Web's internal style resolution for style arrays uses the same indexed setter path when it encounters a numeric StyleSheet ID alongside an inline object.

**Fix:** Use `StyleSheet.flatten` to produce a plain object before passing merged styles to any element on web:
```tsx
// ❌
style={[styles.container, { backgroundColor: colors.surface }]}

// ✅
style={StyleSheet.flatten([styles.container, { backgroundColor: colors.surface }])}
```

### 4. `animationType="fade"` on `Modal`

**Symptom:** `Animated: useNativeDriver is not supported` warning + `CSSStyleDeclaration` crash when the modal is opened.

**Root cause:** RN `Modal` with `animationType="fade"` wraps content in `Animated.View` with a mixed style array internally. Web has no native animation module, so it falls back to JS-based animation which hits the same indexed setter path.

**Fix:** Use `animationType="none"` for web-only modals (those already returning `null` on native have no need for animation):
```tsx
// ❌
<Modal transparent visible animationType="fade" ...>

// ✅
<Modal transparent visible animationType="none" ...>
```

---

## Debugging Strategy

When you see a CSS crash or Animated warning on web:

1. **Start Metro + open `localhost:8081` with localStorage cleared** — this reproduces the state a first-time / incognito user sees, which is where these crashes hide.

2. **Capture `pageerror` events first** — the `pageerror` payload includes a proper stack trace with source-mapped file references pointing to your own code (e.g. `src/components/LandingPage/LandingFooter.tsx:12`). The `console` warning messages are often misleading noise from RNW internals.

3. **Read the Component Stack in the dev overlay** — in dev mode, the error overlay shows a "Component Stack" with your source files. This identifies which component is responsible faster than reading the call stack.

4. **Search for `[styles.` in the culprit file** — style arrays are the #1 cause. `grep -n '\[styles\.' src/components/YourComponent.tsx` finds every candidate in seconds.

5. **Verify in the browser before committing** — after applying a fix, reload with cleared localStorage and confirm `errors` is empty before pushing.

---

## Remaining Noise (not crashes)

These warnings appear on every web load and are pre-existing, not caused by app code:

| Warning | Source | Safe to ignore |
|---|---|---|
| `shadow* style props are deprecated. Use boxShadow.` | React Native Paper components | Yes — Paper upstream issue |
| `props.pointerEvents is deprecated. Use style.pointerEvents` | React Native Web internals | Yes — RNW upstream issue |
| `[Reanimated] Property [transform] may be overwritten by a layout animation` | Reanimated + Paper | Yes — cosmetic |
| `useNativeDriver is not supported` | Any `Animated` usage without `useNativeDriver: false` | Yes, unless paired with a crash |
| Firebase App Check 403 | Debug token not configured for localhost | Yes — expected in dev |
