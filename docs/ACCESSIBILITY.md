# Accessibility Guide

This document defines the accessibility conventions used in Clanker for both web and native (iOS/Android). The web build is intended to mirror the native experience except where platform constraints force divergence; accessibility fixes belong in shared `.tsx` files so both platforms benefit.

## Props Reference

| Prop | Purpose | When to use |
|------|---------|-------------|
| `accessible={true}` | Makes element discoverable by assistive technologies | Non-interactive elements that need to be announced (images, status regions) |
| `accessibilityLabel` | The text announced by screen readers | Every accessible element that isn't purely decorative |
| `accessibilityHint` | Additional context about what will happen | Only when the action isn't obvious from the label alone |
| `accessibilityRole` | Semantic role of the element | All interactive elements and meaningful non-interactive elements |
| `accessibilityState` | Current state (busy, disabled, checked, expanded) | Interactive elements with stateful behavior |
| `accessibilityValue` | Current value for range-based components | Progress bars, sliders |
| `accessibilityLiveRegion` | Android: announce content changes | Dynamic status text (Android only — `"polite"` or `"assertive"`) |

## Role Conventions

| Role | Used for |
|------|----------|
| `"button"` | Pressable, TouchableOpacity, tappable elements |
| `"image"` | Images, avatars, icons that carry meaning |
| `"link"` | Navigation to another screen or URL |
| `"progressbar"` | Loading spinners, progress indicators |
| `"header"` | Section headings |
| `"status"` | Web/ARIA status regions only. On native, use `accessibilityLiveRegion` for dynamic announcements. |

## Label Conventions

- **Labels describe WHAT the element is** — e.g., `"Edit Frodo"`, `"Clanker logo"`, `"42 credits remaining"`.
- **Labels do NOT include the role** — don't say `"Edit button"` or `"Clanker logo image"`.
- **Dynamic labels use template strings** — e.g., `` `Edit ${name}` ``, `` `${credits} credits remaining` ``.
- **Fallback labels for missing data** — always provide a meaningful fallback, e.g., `"Character avatar"` when name is unknown.

## Hint Conventions

- **Hints describe WHAT WILL HAPPEN** — e.g., `"Opens character editor"`, `"Opens subscription management"`.
- **Only add hints when action isn't obvious from the label** — `"Add document to memory"` doesn't need a hint. `"42 credits remaining"` needs `"Opens subscription management"`.

## Decorative Elements

Icons or emoji that are purely decorative (e.g., inside a `Pressable` that already has `accessibilityLabel`) need no extra props — the parent label takes over announcement for both VoiceOver and TalkBack.

## Live Regions

For dynamic status text that should be announced when it changes (e.g., voice chat state):

```tsx
<View
  accessibilityLiveRegion="polite"  // Android TalkBack
>
  <Text>{statusText}</Text>
</View>
```

On iOS, VoiceOver detects text changes automatically when the text is inside a visible view.
Do not rely on `accessibilityRole="status"` for native, because support is not consistent across React Native versions.

## Skip Link (web only)

The landing page renders a web-only skip link as the first focusable element using a native `<a href="#main-content">` anchor. It is visually hidden off-screen by default (`top: -9999px`) and slides into view when keyboard-focused, following the standard skip-link pattern. Activating it programmatically moves keyboard focus to the `#main-content` target via `element.focus()`. The target `View` has `tabIndex={-1}` so it is not in the natural tab order but can receive programmatic focus.

## Testing

Every accessible component should have a test asserting:
1. `accessibilityLabel` value (or dynamic behavior)
2. `accessibilityRole` value
3. Any `accessibilityState` or `accessibilityHint` that's part of the contract

See `__tests__/logo.test.tsx`, `__tests__/characterCardAccessibility.test.tsx`, etc. for examples.

## Further Reading

- [React Native Accessibility docs](https://reactnative.dev/docs/accessibility)
- [WCAG 2.1 Quick Reference](https://www.w3.org/WAI/WCAG21/quickref/)
- Design spec: [docs/superpowers/specs/2026-04-30-web-accessibility-fixes-design.md](superpowers/specs/2026-04-30-web-accessibility-fixes-design.md)
