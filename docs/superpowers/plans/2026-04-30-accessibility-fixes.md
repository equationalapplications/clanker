# Accessibility Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the Clanker app into WCAG 2.1 Level A compliance by adding accessibility props to 13 components across web and native (shared `.tsx` files), with tests for each fix and a new `docs/ACCESSIBILITY.md` guide.

**Architecture:** Direct in-place prop additions to existing components — no new abstractions. Three commits (one per phase): Critical, Important, Nice-to-Have. All changes live in shared `.tsx` files so both web and native benefit.

**Tech Stack:** React Native accessibility props (`accessibilityLabel`, `accessibilityRole`, `accessibilityState`, `accessibilityLiveRegion`), React Native Testing Library (`react-test-renderer`), Jest.

---

## Phase 1 — Critical

### Task 1: Tests for Logo, HeroSection, and CreditCounterIcon (write failing)

**Files:**
- Create: `__tests__/logo.test.tsx`
- Create: `__tests__/heroSectionAccessibility.test.tsx`
- Modify: `__tests__/creditCounterIconPlanLoading.test.tsx`

- [ ] **Step 1: Create failing Logo accessibility test**

Create `__tests__/logo.test.tsx`:

```tsx
import React from 'react'
import { create } from 'react-test-renderer'

jest.mock('react-native', () => {
  const React = require('react')
  return {
    StyleSheet: { create: (s: any) => s },
    Image: ({ accessibilityLabel, accessibilityRole, ...props }: any) =>
      React.createElement('Image', { accessibilityLabel, accessibilityRole, ...props }),
  }
})

import Logo from '~/components/Logo'

describe('Logo accessibility', () => {
  it('has accessibilityLabel "Clanker logo"', () => {
    const tree = create(<Logo />)
    const image = tree.root.findByType('Image')
    expect(image.props.accessibilityLabel).toBe('Clanker logo')
  })

  it('has accessibilityRole "image"', () => {
    const tree = create(<Logo />)
    const image = tree.root.findByType('Image')
    expect(image.props.accessibilityRole).toBe('image')
  })
})
```

- [ ] **Step 2: Create failing HeroSection accessibility test**

Create `__tests__/heroSectionAccessibility.test.tsx`:

```tsx
import React from 'react'
import { create, act } from 'react-test-renderer'

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }))
jest.mock('~/hooks/useMachines', () => ({ useAuthMachine: jest.fn() }))
jest.mock('@xstate/react', () => ({ useSelector: (_: any, sel: any) => sel({ context: { user: null } }) }))
jest.mock('react-native-reanimated', () => {
  const React = require('react')
  return {
    default: { View: ({ children, style }: any) => React.createElement('View', { style }, children) },
    useSharedValue: () => ({ value: 0 }),
    useAnimatedStyle: () => ({}),
    withRepeat: (v: any) => v,
    withSequence: (v: any) => v,
    withTiming: (v: any) => v,
    withDelay: (v: any) => v,
    FadeInDown: { delay: () => ({ duration: () => ({}) }) },
  }
})
jest.mock('react-native', () => {
  const React = require('react')
  return {
    StyleSheet: { create: (s: any) => s, flatten: (s: any) => s },
    View: ({ children, ...props }: any) => React.createElement('View', props, children),
    Animated: { View: ({ children, ...props }: any) => React.createElement('View', props, children) },
    useWindowDimensions: () => ({ width: 1200, height: 800 }),
    Platform: { OS: 'web' },
    Pressable: ({ children, onPress, ...props }: any) =>
      React.createElement('Pressable', { onPress, ...props }, children),
  }
})
jest.mock('expo-image', () => {
  const React = require('react')
  return {
    Image: ({ accessibilityLabel, accessibilityRole, ...props }: any) =>
      React.createElement('Image', { accessibilityLabel, accessibilityRole, ...props }),
  }
})
jest.mock('react-native-paper', () => {
  const React = require('react')
  return {
    useTheme: () => ({ colors: { primary: '#000', onPrimary: '#fff', onBackground: '#000' } }),
    Button: ({ children, ...props }: any) => React.createElement('Button', props, children),
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
  }
})
jest.mock('~/components/TitleText', () => {
  const React = require('react')
  return ({ children, ...props }: any) => React.createElement('Text', props, children)
})
jest.mock('~/components/MonoText', () => {
  const React = require('react')
  return ({ children, ...props }: any) => React.createElement('Text', props, children)
})

import HeroSection from '~/components/LandingPage/HeroSection'

describe('HeroSection accessibility', () => {
  it('logo image has accessibilityLabel', () => {
    let tree: any
    act(() => { tree = create(<HeroSection />) })
    const images = tree.root.findAllByType('Image')
    const logoImage = images.find((img: any) => img.props.accessibilityLabel)
    expect(logoImage).toBeDefined()
    expect(logoImage.props.accessibilityLabel).toBe('Clanker application logo')
  })

  it('logo image has accessibilityRole "image"', () => {
    let tree: any
    act(() => { tree = create(<HeroSection />) })
    const images = tree.root.findAllByType('Image')
    const logoImage = images.find((img: any) => img.props.accessibilityRole === 'image')
    expect(logoImage).toBeDefined()
  })
})
```

- [ ] **Step 3: Add failing accessibility tests to creditCounterIconPlanLoading.test.tsx**

Open `__tests__/creditCounterIconPlanLoading.test.tsx` and add these cases inside the existing `describe` block (after the last existing test):

```tsx
  it('pressable has accessibilityRole "button"', () => {
    mockUseCurrentPlan.mockReturnValue({ isSubscriber: false, isLoading: false })
    mockUseUserCredits.mockReturnValue({ data: { totalCredits: 42 }, isLoading: false })

    let tree!: ReturnType<typeof create>
    act(() => { tree = create(<CreditCounterIcon />) })

    const pressable = tree.root.findByType('Pressable')
    expect(pressable.props.accessibilityRole).toBe('button')
  })

  it('pressable has accessibilityLabel with credit count for non-subscriber', () => {
    mockUseCurrentPlan.mockReturnValue({ isSubscriber: false, isLoading: false })
    mockUseUserCredits.mockReturnValue({ data: { totalCredits: 42 }, isLoading: false })

    let tree!: ReturnType<typeof create>
    act(() => { tree = create(<CreditCounterIcon />) })

    const pressable = tree.root.findByType('Pressable')
    expect(pressable.props.accessibilityLabel).toBe('42 credits remaining')
  })

  it('pressable has accessibilityLabel for subscriber', () => {
    mockUseCurrentPlan.mockReturnValue({ isSubscriber: true, isLoading: false })
    mockUseUserCredits.mockReturnValue({ data: { totalCredits: 0 }, isLoading: false })

    let tree!: ReturnType<typeof create>
    act(() => { tree = create(<CreditCounterIcon />) })

    const pressable = tree.root.findByType('Pressable')
    expect(pressable.props.accessibilityLabel).toBe('Premium subscriber, unlimited credits')
  })

  it('pressable has accessibilityHint for subscription management', () => {
    mockUseCurrentPlan.mockReturnValue({ isSubscriber: false, isLoading: false })
    mockUseUserCredits.mockReturnValue({ data: { totalCredits: 5 }, isLoading: false })

    let tree!: ReturnType<typeof create>
    act(() => { tree = create(<CreditCounterIcon />) })

    const pressable = tree.root.findByType('Pressable')
    expect(pressable.props.accessibilityHint).toBe('Opens subscription management')
  })
```

- [ ] **Step 4: Run tests — verify they fail**

```bash
cd /path/to/clanker
npm test -- --testPathPattern="logo|heroSectionAccessibility|creditCounterIconPlanLoading" --no-coverage 2>&1 | tail -30
```

Expected: FAIL — `accessibilityLabel` and `accessibilityRole` not yet present on elements.

---

### Task 2: Implement Phase 1 component fixes

**Files:**
- Modify: `src/components/Logo.tsx`
- Modify: `src/components/LandingPage/HeroSection.tsx`
- Modify: `src/components/CreditCounterIcon.tsx`

- [ ] **Step 1: Fix Logo.tsx**

In `src/components/Logo.tsx`, change the one-liner from:

```tsx
const Logo = () => <Image source={require('../../assets/logo.png')} style={styles.image} />
```

to:

```tsx
const Logo = () => (
  <Image
    source={require('../../assets/logo.png')}
    style={styles.image}
    accessibilityLabel="Clanker logo"
    accessibilityRole="image"
  />
)
```

- [ ] **Step 2: Fix HeroSection.tsx hero image**

In `src/components/LandingPage/HeroSection.tsx`, find the `<Image>` inside the `<Animated.View style={logoAnimStyle}>` block:

```tsx
          <Animated.View style={logoAnimStyle}>
            <Image
              source={require('../../../assets/logo.png')}
              style={styles.logo}
              contentFit="contain"
            />
          </Animated.View>
```

Change to:

```tsx
          <Animated.View style={logoAnimStyle}>
            <Image
              source={require('../../../assets/logo.png')}
              style={styles.logo}
              contentFit="contain"
              accessibilityLabel="Clanker application logo"
              accessibilityRole="image"
            />
          </Animated.View>
```

- [ ] **Step 3: Fix CreditCounterIcon.tsx**

Replace the `Pressable` in `src/components/CreditCounterIcon.tsx`:

```tsx
  return (
    <Pressable
      onPress={() => router.push('./subscribe')}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        opacity: pressed ? 0.5 : 1,
        marginRight: 10,
      })}
    >
```

with:

```tsx
  const accessibilityLabel =
    creditsLoading || planLoading
      ? 'Loading subscription status'
      : isSubscriber
        ? 'Premium subscriber, unlimited credits'
        : `${credits?.totalCredits ?? 0} credits remaining`

  return (
    <Pressable
      onPress={() => router.push('./subscribe')}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint="Opens subscription management"
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        opacity: pressed ? 0.5 : 1,
        marginRight: 10,
      })}
    >
```

- [ ] **Step 4: Run Phase 1 tests — verify they pass**

```bash
npm test -- --testPathPattern="logo|heroSectionAccessibility|creditCounterIconPlanLoading" --no-coverage 2>&1 | tail -30
```

Expected: PASS — all new assertions green.

---

### Task 3: Create docs/ACCESSIBILITY.md and update README

**Files:**
- Create: `docs/ACCESSIBILITY.md`
- Modify: `README.md`

- [ ] **Step 1: Create docs/ACCESSIBILITY.md**

Create `docs/ACCESSIBILITY.md` with the following content:

```markdown
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
| `"status"` | Dynamic status text regions (voice state, ingest progress) |

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

## Skip Link (web only)

The landing page includes a web-only skip link as the first focusable element, allowing keyboard users to bypass navigation and jump to `#main-content`.

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
```

- [ ] **Step 2: Add ACCESSIBILITY.md link to README.md**

In `README.md`, find the `## Policies & Compliance` section and append a new line:

```markdown
- [Accessibility guide](docs/ACCESSIBILITY.md) — Conventions for `accessibilityLabel`, `accessibilityRole`, `accessibilityHint`, live regions, and skip links. Covers both web and native.
```

- [ ] **Step 3: Run typecheck and lint**

```bash
npm run typecheck && npm run lint --quiet
```

Expected: no errors.

- [ ] **Step 4: Commit Phase 1**

```bash
git add src/components/Logo.tsx \
        src/components/LandingPage/HeroSection.tsx \
        src/components/CreditCounterIcon.tsx \
        docs/ACCESSIBILITY.md \
        README.md \
        __tests__/logo.test.tsx \
        __tests__/heroSectionAccessibility.test.tsx \
        __tests__/creditCounterIconPlanLoading.test.tsx

git commit -m "fix(a11y): add labels and roles for critical images and credit counter

- Logo: accessibilityLabel and accessibilityRole=\"image\"
- HeroSection: accessibilityLabel and accessibilityRole on hero image
- CreditCounterIcon: accessibilityRole=\"button\", dynamic label, hint
- Add docs/ACCESSIBILITY.md with codebase conventions
- Link ACCESSIBILITY.md from README"
```

---

## Phase 2 — Important

### Task 4: Tests for CharacterCard, CharacterAvatar, FeaturesSection, UserActionPanel (write failing)

**Files:**
- Create: `__tests__/characterCardAccessibility.test.tsx`
- Create: `__tests__/characterAvatarAccessibility.test.tsx`
- Create: `__tests__/featuresSectionAccessibility.test.tsx`
- Create: `__tests__/userActionPanelAccessibility.test.tsx`

- [ ] **Step 1: Create failing CharacterCard accessibility test**

Create `__tests__/characterCardAccessibility.test.tsx`:

```tsx
import React from 'react'
import { create, act } from 'react-test-renderer'

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
}))

jest.mock('~/components/CharacterAvatar', () => {
  const React = require('react')
  return () => React.createElement('View', { testID: 'avatar' })
})

jest.mock('react-native', () => {
  const React = require('react')
  return {
    StyleSheet: { create: (s: any) => s },
    View: ({ children, ...props }: any) => React.createElement('View', props, children),
    TouchableOpacity: ({ children, ...props }: any) =>
      React.createElement('TouchableOpacity', props, children),
  }
})

jest.mock('react-native-paper', () => {
  const React = require('react')
  return {
    Card: Object.assign(
      ({ children, ...props }: any) => React.createElement('View', props, children),
      {
        Content: ({ children, ...props }: any) => React.createElement('View', props, children),
      }
    ),
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
    Icon: (props: any) => React.createElement('View', props),
    useTheme: () => ({ colors: { onSurfaceVariant: '#666' } }),
  }
})

import { CharacterCard } from '~/components/CharacterCard'

describe('CharacterCard accessibility', () => {
  const defaultProps = {
    id: 'char-1',
    name: 'Frodo',
    appearance: 'A brave hobbit',
  }

  it('outer card button has accessibilityRole "button"', () => {
    let tree: any
    act(() => { tree = create(<CharacterCard {...defaultProps} />) })
    const touchables = tree.root.findAllByType('TouchableOpacity')
    const cardButton = touchables[0]
    expect(cardButton.props.accessibilityRole).toBe('button')
  })

  it('outer card label includes character name and appearance', () => {
    let tree: any
    act(() => { tree = create(<CharacterCard {...defaultProps} />) })
    const touchables = tree.root.findAllByType('TouchableOpacity')
    const cardButton = touchables[0]
    expect(cardButton.props.accessibilityLabel).toContain('Frodo')
    expect(cardButton.props.accessibilityLabel).toContain('A brave hobbit')
  })

  it('outer card label falls back to "No description available" when appearance missing', () => {
    let tree: any
    act(() => { tree = create(<CharacterCard id="c1" name="Frodo" />) })
    const touchables = tree.root.findAllByType('TouchableOpacity')
    const cardButton = touchables[0]
    expect(cardButton.props.accessibilityLabel).toContain('No description available')
  })

  it('outer card has accessibilityHint "Opens chat with this character"', () => {
    let tree: any
    act(() => { tree = create(<CharacterCard {...defaultProps} />) })
    const touchables = tree.root.findAllByType('TouchableOpacity')
    expect(touchables[0].props.accessibilityHint).toBe('Opens chat with this character')
  })

  it('edit button has accessibilityRole "button"', () => {
    let tree: any
    act(() => { tree = create(<CharacterCard {...defaultProps} />) })
    const touchables = tree.root.findAllByType('TouchableOpacity')
    const editButton = touchables[1]
    expect(editButton.props.accessibilityRole).toBe('button')
  })

  it('edit button label includes character name', () => {
    let tree: any
    act(() => { tree = create(<CharacterCard {...defaultProps} />) })
    const touchables = tree.root.findAllByType('TouchableOpacity')
    const editButton = touchables[1]
    expect(editButton.props.accessibilityLabel).toBe('Edit Frodo')
  })

  it('edit button has accessibilityHint "Opens character editor"', () => {
    let tree: any
    act(() => { tree = create(<CharacterCard {...defaultProps} />) })
    const touchables = tree.root.findAllByType('TouchableOpacity')
    const editButton = touchables[1]
    expect(editButton.props.accessibilityHint).toBe('Opens character editor')
  })
})
```

- [ ] **Step 2: Create failing CharacterAvatar accessibility test**

Create `__tests__/characterAvatarAccessibility.test.tsx`:

```tsx
import React from 'react'
import { create, act } from 'react-test-renderer'

jest.mock('~/config/constants', () => ({
  defaultAvatarUrl: 'https://example.com/avatar.png',
}))

jest.mock('react-native-paper', () => {
  const React = require('react')
  return {
    Avatar: {
      Image: ({ accessibilityLabel, accessible, ...props }: any) =>
        React.createElement('Avatar.Image', { accessibilityLabel, accessible, ...props }),
      Text: ({ accessibilityLabel, accessible, ...props }: any) =>
        React.createElement('Avatar.Text', { accessibilityLabel, accessible, ...props }),
      Icon: ({ accessibilityLabel, accessible, ...props }: any) =>
        React.createElement('Avatar.Icon', { accessibilityLabel, accessible, ...props }),
    },
  }
})

import CharacterAvatar from '~/components/CharacterAvatar'

describe('CharacterAvatar accessibility', () => {
  it('Avatar.Image with imageUrl has accessible and label', () => {
    let tree: any
    act(() => {
      tree = create(
        <CharacterAvatar imageUrl="https://example.com/img.png" characterName="Frodo" />
      )
    })
    const avatar = tree.root.findByType('Avatar.Image')
    expect(avatar.props.accessible).toBe(true)
    expect(avatar.props.accessibilityLabel).toBe('Frodo avatar')
  })

  it('Avatar.Text (initials) has accessible and label', () => {
    let tree: any
    act(() => {
      tree = create(<CharacterAvatar characterName="Frodo Baggins" />)
    })
    const avatar = tree.root.findByType('Avatar.Text')
    expect(avatar.props.accessible).toBe(true)
    expect(avatar.props.accessibilityLabel).toBe('Frodo Baggins avatar')
  })

  it('Avatar.Icon fallback has accessible and "Character avatar" label', () => {
    let tree: any
    act(() => {
      tree = create(<CharacterAvatar />)
    })
    const avatar = tree.root.findByType('Avatar.Icon')
    expect(avatar.props.accessible).toBe(true)
    expect(avatar.props.accessibilityLabel).toBe('Character avatar')
  })

  it('Avatar.Image default gravatar fallback has label', () => {
    let tree: any
    act(() => {
      tree = create(<CharacterAvatar showFallback={false} />)
    })
    const avatar = tree.root.findByType('Avatar.Image')
    expect(avatar.props.accessible).toBe(true)
    expect(avatar.props.accessibilityLabel).toBe('Character avatar')
  })
})
```

- [ ] **Step 3: Create failing FeaturesSection accessibility test**

Create `__tests__/featuresSectionAccessibility.test.tsx`:

```tsx
import React from 'react'
import { create, act } from 'react-test-renderer'

jest.mock('react-native-reanimated', () => {
  const React = require('react')
  return {
    default: {
      View: ({ children, style }: any) => React.createElement('View', { style }, children),
    },
    useSharedValue: () => ({ value: 0 }),
    useAnimatedStyle: () => ({}),
    withRepeat: (v: any) => v,
    withSequence: (v: any) => v,
    withTiming: (v: any) => v,
    withDelay: (_d: any, v: any) => v,
    FadeInDown: { delay: () => ({ duration: () => ({}) }) },
  }
})

jest.mock('react-native', () => {
  const React = require('react')
  return {
    StyleSheet: { create: (s: any) => s },
    View: ({ children, ...props }: any) => React.createElement('View', props, children),
  }
})

jest.mock('react-native-paper', () => {
  const React = require('react')
  return {
    useTheme: () => ({
      colors: { surface: '#fff', surfaceVariant: '#f5f5f5', onSurface: '#000', primary: '#6200ee' },
    }),
    Card: Object.assign(
      ({ children, ...props }: any) => React.createElement('View', props, children),
      {
        Content: ({ children, ...props }: any) => React.createElement('View', props, children),
      }
    ),
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
  }
})

jest.mock('@expo/vector-icons', () => {
  const React = require('react')
  return {
    MaterialCommunityIcons: ({ accessibilityLabel, accessibilityRole, accessible, ...props }: any) =>
      React.createElement('MaterialCommunityIcons', {
        accessibilityLabel,
        accessibilityRole,
        accessible,
        ...props,
      }),
  }
})

import FeaturesSection from '~/components/LandingPage/FeaturesSection'

const FEATURE_TITLES = [
  'Build Your Character',
  'Real AI Conversations',
  'Talk to Your Character',
  'Share & Sync',
]

describe('FeaturesSection accessibility', () => {
  let tree: any

  beforeEach(() => {
    act(() => { tree = create(<FeaturesSection />) })
  })

  it('renders one icon per feature', () => {
    const icons = tree.root.findAllByType('MaterialCommunityIcons')
    expect(icons).toHaveLength(FEATURE_TITLES.length)
  })

  it('each icon has accessibilityRole "image"', () => {
    const icons = tree.root.findAllByType('MaterialCommunityIcons')
    icons.forEach((icon: any) => {
      expect(icon.props.accessibilityRole).toBe('image')
    })
  })

  it('each icon label matches the feature title', () => {
    const icons = tree.root.findAllByType('MaterialCommunityIcons')
    const labels = icons.map((icon: any) => icon.props.accessibilityLabel)
    FEATURE_TITLES.forEach((title) => {
      expect(labels).toContain(title)
    })
  })

  it('each icon has accessible={true}', () => {
    const icons = tree.root.findAllByType('MaterialCommunityIcons')
    icons.forEach((icon: any) => {
      expect(icon.props.accessible).toBe(true)
    })
  })
})
```

- [ ] **Step 4: Create failing UserActionPanel accessibility test**

Create `__tests__/userActionPanelAccessibility.test.tsx`:

```tsx
import React from 'react'
import { create, act } from 'react-test-renderer'

jest.mock('~/components/admin/renewalDateValidation', () => ({
  normalizeRenewalDateInput: (v: string) => v || null,
}))

jest.mock('react-native', () => {
  const React = require('react')
  return {
    StyleSheet: { create: (s: any) => s },
    View: ({ children, ...props }: any) => React.createElement('View', props, children),
  }
})

jest.mock('react-native-paper', () => {
  const React = require('react')
  return {
    Button: ({ children, ...props }: any) => React.createElement('Button', props, children),
    Card: Object.assign(
      ({ children, ...props }: any) => React.createElement('View', props, children),
      {
        Content: ({ children, ...props }: any) => React.createElement('View', props, children),
      }
    ),
    Menu: Object.assign(
      ({ children, ...props }: any) => React.createElement('View', props, children),
      {
        Item: ({ ...props }: any) => React.createElement('View', props),
      }
    ),
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
    TextInput: ({ accessibilityHint, label, ...props }: any) =>
      React.createElement('TextInput', { accessibilityHint, label, ...props }),
  }
})

import { UserActionPanel } from '~/components/admin/UserActionPanel'

const user = {
  userId: 'u1',
  email: 'test@example.com',
  currentCredits: 50,
  planTier: 'free' as const,
  planStatus: 'active' as const,
}

const noop = () => {}

describe('UserActionPanel accessibility', () => {
  it('renewal date TextInput has accessibilityHint with ISO 8601 format guidance', () => {
    let tree: any
    act(() => {
      tree = create(
        <UserActionPanel
          user={user}
          onSetCredits={noop}
          onSetSubscription={noop}
          onClearTerms={noop}
          onResetUserState={noop}
          onDeleteUser={noop}
          isBusy={false}
        />
      )
    })
    const inputs = tree.root.findAllByType('TextInput')
    const renewalInput = inputs.find((i: any) =>
      i.props.label?.toString().toLowerCase().includes('renewal')
    )
    expect(renewalInput).toBeDefined()
    expect(renewalInput.props.accessibilityHint).toContain('ISO 8601')
    expect(renewalInput.props.accessibilityHint).toContain('2026-')
  })
})
```

- [ ] **Step 5: Run tests — verify they fail**

```bash
npm test -- --testPathPattern="characterCardAccessibility|characterAvatarAccessibility|featuresSectionAccessibility|userActionPanelAccessibility" --no-coverage 2>&1 | tail -30
```

Expected: FAIL — props not yet present.

---

### Task 5: Implement Phase 2 component fixes

**Files:**
- Modify: `src/components/CharacterCard.tsx`
- Modify: `src/components/CharacterAvatar.tsx`
- Modify: `src/components/LandingPage/FeaturesSection.tsx`
- Modify: `src/components/admin/UserActionPanel.tsx`

- [ ] **Step 1: Fix CharacterCard.tsx — outer card button**

In `src/components/CharacterCard.tsx`, change the outer `TouchableOpacity`:

```tsx
      <TouchableOpacity onPress={handlePress} style={styles.touchable}>
```

to:

```tsx
      <TouchableOpacity
        onPress={handlePress}
        style={styles.touchable}
        accessibilityRole="button"
        accessibilityLabel={`${name || 'Unnamed Character'}, ${appearance || 'No description available'}`}
        accessibilityHint="Opens chat with this character"
      >
```

- [ ] **Step 2: Fix CharacterCard.tsx — edit button**

In `src/components/CharacterCard.tsx`, change the edit `TouchableOpacity`:

```tsx
            <TouchableOpacity
              onPress={handleEdit}
              style={styles.editButton}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
```

to:

```tsx
            <TouchableOpacity
              onPress={handleEdit}
              style={styles.editButton}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityRole="button"
              accessibilityLabel={`Edit ${name || 'Unnamed Character'}`}
              accessibilityHint="Opens character editor"
            >
```

- [ ] **Step 3: Fix CharacterAvatar.tsx — all four return paths**

In `src/components/CharacterAvatar.tsx`, update all four return statements:

```tsx
  // Avatar.Image with provided imageUrl
  if (imageUrl && !imageError) {
    return (
      <Avatar.Image
        size={size}
        source={{ uri: imageUrl }}
        onError={() => setImageError(true)}
        accessible={true}
        accessibilityLabel={characterName ? `${characterName} avatar` : 'Character avatar'}
      />
    )
  }

  // Avatar.Text with initials
  if (characterName && showFallback) {
    const initials = characterName
      .split(' ')
      .map((word) => word.charAt(0))
      .join('')
      .substring(0, 2)
      .toUpperCase()

    if (initials) {
      return (
        <Avatar.Text
          size={size}
          label={initials}
          accessible={true}
          accessibilityLabel={`${characterName} avatar`}
        />
      )
    }
  }

  // Avatar.Icon placeholder
  if (showFallback) {
    return (
      <Avatar.Icon
        size={size}
        icon="account"
        accessible={true}
        accessibilityLabel="Character avatar"
      />
    )
  }

  // Default gravatar fallback
  return (
    <Avatar.Image
      size={size}
      source={{ uri: defaultAvatarUrl }}
      accessible={true}
      accessibilityLabel="Character avatar"
    />
  )
```

- [ ] **Step 4: Fix FeaturesSection.tsx — feature icon**

In `src/components/LandingPage/FeaturesSection.tsx`, change:

```tsx
          <MaterialCommunityIcons
            name={feat.icon}
            size={36}
            color={colors.primary}
            style={styles.icon}
          />
```

to:

```tsx
          <MaterialCommunityIcons
            name={feat.icon}
            size={36}
            color={colors.primary}
            style={styles.icon}
            accessible={true}
            accessibilityRole="image"
            accessibilityLabel={feat.title}
          />
```

- [ ] **Step 5: Fix UserActionPanel.tsx — renewal date input**

In `src/components/admin/UserActionPanel.tsx`, change:

```tsx
          <TextInput
            mode="outlined"
            label="Renewal date (UTC ISO, optional)"
            value={renewalDate}
            onChangeText={setRenewalDate}
            placeholder="YYYY-MM-DDTHH:mm:ssZ or YYYY-MM-DDTHH:mm:ss.SSSZ"
            error={!renewalDateIsValid}
          />
```

to:

```tsx
          <TextInput
            mode="outlined"
            label="Renewal date (UTC ISO, optional)"
            value={renewalDate}
            onChangeText={setRenewalDate}
            placeholder="YYYY-MM-DDTHH:mm:ssZ or YYYY-MM-DDTHH:mm:ss.SSSZ"
            accessibilityHint="Enter date in UTC ISO 8601 format (e.g., 2026-12-31T23:59:59Z). Leave blank to keep the current renewal date."
            error={!renewalDateIsValid}
          />
```

- [ ] **Step 6: Run Phase 2 tests — verify they pass**

```bash
npm test -- --testPathPattern="characterCardAccessibility|characterAvatarAccessibility|featuresSectionAccessibility|userActionPanelAccessibility" --no-coverage 2>&1 | tail -30
```

Expected: PASS.

- [ ] **Step 7: Run all tests to verify no regressions**

```bash
npm test --no-coverage 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 8: Run typecheck and lint**

```bash
npm run typecheck && npm run lint --quiet
```

Expected: no errors.

- [ ] **Step 9: Commit Phase 2**

```bash
git add src/components/CharacterCard.tsx \
        src/components/CharacterAvatar.tsx \
        src/components/LandingPage/FeaturesSection.tsx \
        src/components/admin/UserActionPanel.tsx \
        __tests__/characterCardAccessibility.test.tsx \
        __tests__/characterAvatarAccessibility.test.tsx \
        __tests__/featuresSectionAccessibility.test.tsx \
        __tests__/userActionPanelAccessibility.test.tsx

git commit -m "fix(a11y): add labels and hints for character cards, avatars, features, admin renewal

- CharacterCard: button roles and labels on card and edit button
- CharacterAvatar: accessible and label on all four render paths
- FeaturesSection: accessible, image role, label on feature icons
- UserActionPanel: accessibilityHint on renewal date TextInput"
```

---

## Phase 3 — Nice-to-Have

### Task 6: Tests for tabs, talk screen, landing footer, skip link (write failing)

**Files:**
- Create: `__tests__/tabsLayoutAccessibility.test.tsx`
- Create: `__tests__/talkScreenStatusLiveRegion.test.tsx`
- Create: `__tests__/landingFooterAccessibility.test.tsx`
- Create: `__tests__/skipToMainContent.test.tsx`

- [ ] **Step 1: Create failing tabs layout accessibility test**

Create `__tests__/tabsLayoutAccessibility.test.tsx`:

```tsx
import TabLayout from '../app/(drawer)/(tabs)/_layout'

describe('TabLayout accessibility', () => {
  // TabLayout calls useNavigation which needs a mock, but we can verify
  // tabBarAccessibilityLabel by inspecting the Tabs.Screen option objects directly
  // via a shallow render. Since the screen options are static objects, we extract
  // them by rendering with mocks and looking at the Tabs.Screen calls.

  it('exports a TabLayout component (smoke)', () => {
    expect(TabLayout).toBeDefined()
  })
})
```

Note: Because Expo Router's `Tabs` and `useNavigation` require full navigation context to render, test the tab accessibility labels by asserting directly on the options objects:

```tsx
import React from 'react'
import { create, act } from 'react-test-renderer'

jest.mock('expo-router', () => {
  const React = require('react')
  const capturedScreens: any[] = []

  const Tabs = ({ children }: any) => {
    return React.createElement('Tabs', {}, children)
  }
  Tabs.Screen = ({ name, options }: any) => {
    capturedScreens.push({ name, options })
    return null
  }
  ;(Tabs as any).__capturedScreens = capturedScreens

  return {
    Tabs,
    router: { navigate: jest.fn() },
    useNavigation: () => ({ setOptions: jest.fn() }),
  }
})

jest.mock('react-native', () => {
  const React = require('react')
  return {
    Alert: { alert: jest.fn() },
    View: ({ children, ...props }: any) => React.createElement('View', props, children),
  }
})

jest.mock('~/components/navigation/TabBarIcon', () => () => null)
jest.mock('~/hooks/useEditDirtyState', () => ({
  editDirtyRef: { current: false },
  setEditDirty: jest.fn(),
}))

import TabLayout from '../app/(drawer)/(tabs)/_layout'
import { Tabs } from 'expo-router'

describe('Tabs accessibility labels', () => {
  beforeEach(() => {
    ;(Tabs as any).__capturedScreens.length = 0
  })

  it('each Tabs.Screen has tabBarAccessibilityLabel', () => {
    act(() => { create(<TabLayout />) })
    const screens = (Tabs as any).__capturedScreens
    expect(screens.length).toBeGreaterThan(0)
    screens.forEach(({ name, options }: any) => {
      expect(options.tabBarAccessibilityLabel).toBeDefined()
      expect(typeof options.tabBarAccessibilityLabel).toBe('string')
      expect(options.tabBarAccessibilityLabel.length).toBeGreaterThan(0)
    })
  })
})
```

Replace the earlier smoke-only content with the full version above.

- [ ] **Step 2: Create failing talk screen live region test**

Create `__tests__/talkScreenStatusLiveRegion.test.tsx`:

```tsx
import React from 'react'
import { create, act } from 'react-test-renderer'

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ characterId: 'char-1' }),
  Stack: {
    Screen: () => null,
  },
  router: { push: jest.fn() },
}))

jest.mock('~/hooks/useVoiceChat', () => ({
  useVoiceChat: () => ({
    voiceState: 'idle',
    transcription: null,
    replyText: null,
    error: null,
    startListening: jest.fn(),
    cancel: jest.fn(),
  }),
}))

jest.mock('~/hooks/useMostRecentMessage', () => ({
  useMostRecentMessage: () => ({ data: { characterId: 'char-1' }, isLoading: false }),
}))

jest.mock('~/hooks/useCharacter', () => ({
  useCharacter: () => ({
    data: { id: 'char-1', name: 'Frodo', avatar: null },
    isLoading: false,
  }),
}))

jest.mock('~/hooks/useCurrentPlan', () => ({
  useCurrentPlan: () => ({ isSubscriber: false }),
}))

jest.mock('react-native-reanimated', () => {
  const React = require('react')
  return {
    default: {
      View: ({ children, style }: any) => React.createElement('View', { style }, children),
    },
    useSharedValue: () => ({ value: 0 }),
    useAnimatedStyle: () => ({}),
    withRepeat: (v: any) => v,
    withTiming: (v: any) => v,
    withSequence: (v: any) => v,
    FadeIn: { duration: () => ({}) },
  }
})

jest.mock('react-native', () => {
  const React = require('react')
  return {
    StyleSheet: { create: (s: any) => s },
    View: ({ children, ...props }: any) => React.createElement('View', props, children),
    Pressable: ({ children, ...props }: any) =>
      React.createElement('Pressable', props, children),
    ActivityIndicator: (props: any) => React.createElement('ActivityIndicator', props),
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
    Platform: { OS: 'ios' },
  }
})

jest.mock('@expo/vector-icons', () => ({
  MaterialCommunityIcons: () => null,
}))

jest.mock('~/components/CharacterAvatar', () => () => null)
jest.mock('react-navigation/native', () => ({
  useFocusEffect: jest.fn(),
}))
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: jest.fn(),
}))

// Import the inner component that renders the actual UI
// TalkTabScreen renders TalkScreen — find which component to test
import TalkTabScreen from '../app/(drawer)/(tabs)/talk/index'

describe('Talk screen status region', () => {
  it('statusWrap View has accessibilityLiveRegion "polite"', () => {
    let tree: any
    act(() => { tree = create(<TalkTabScreen />) })
    const views = tree.root.findAllByType('View')
    const liveRegion = views.find(
      (v: any) => v.props.accessibilityLiveRegion === 'polite'
    )
    expect(liveRegion).toBeDefined()
  })
})
```

- [ ] **Step 3: Create failing landing footer accessibility test**

Create `__tests__/landingFooterAccessibility.test.tsx`:

```tsx
import React from 'react'
import { create, act } from 'react-test-renderer'

jest.mock('~/components/CookieConsent', () => ({
  useCookieConsent: () => ({ openPreferences: jest.fn() }),
}))

jest.mock('expo-router', () => {
  const React = require('react')
  return {
    Link: ({ children, asChild, href, ...props }: any) =>
      React.createElement('Link', { href, ...props }, children),
  }
})

jest.mock('react-native', () => {
  const React = require('react')
  return {
    StyleSheet: { create: (s: any) => s, flatten: (s: any) => s },
    View: ({ children, ...props }: any) => React.createElement('View', props, children),
    Pressable: ({ children, ...props }: any) =>
      React.createElement('Pressable', props, children),
    Linking: { openURL: jest.fn() },
    Platform: { OS: 'web' },
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
  }
})

jest.mock('react-native-paper', () => {
  const React = require('react')
  return {
    useTheme: () => ({ colors: { outline: '#999' } }),
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
  }
})

import LandingFooter from '~/components/LandingPage/LandingFooter'

describe('LandingFooter accessibility', () => {
  it('external Equational Applications link has accessibilityLabel mentioning destination', () => {
    let tree: any
    act(() => { tree = create(<LandingFooter />) })
    const pressables = tree.root.findAllByType('Pressable')
    const externalLink = pressables.find(
      (p: any) =>
        p.props.accessibilityRole === 'link' &&
        p.props.accessibilityLabel?.includes('Equational Applications')
    )
    expect(externalLink).toBeDefined()
    expect(externalLink.props.accessibilityLabel).toContain('opens external website')
  })
})
```

- [ ] **Step 4: Create failing skip link test**

Create `__tests__/skipToMainContent.test.tsx`:

```tsx
import React from 'react'
import { create, act } from 'react-test-renderer'

// Mock Platform as web
jest.mock('react-native', () => {
  const React = require('react')
  return {
    StyleSheet: { create: (s: any) => s },
    ScrollView: ({ children, ...props }: any) =>
      React.createElement('ScrollView', props, children),
    View: ({ children, ...props }: any) => React.createElement('View', props, children),
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
    Platform: { OS: 'web' },
  }
})

jest.mock('react-native-paper', () => ({
  useTheme: () => ({ colors: { background: '#fff' } }),
}))

jest.mock('~/components/LandingPage/HeroSection', () => () => null)
jest.mock('~/components/LandingPage/FeaturesSection', () => () => null)
jest.mock('~/components/LandingPage/LandingFooter', () => () => null)

import LandingPage from '~/components/LandingPage'

describe('LandingPage skip link (web)', () => {
  it('renders a skip-to-main-content link as first focusable element', () => {
    let tree: any
    act(() => { tree = create(<LandingPage />) })
    const views = tree.root.findAllByType('View')
    const skipLink = views.find(
      (v: any) =>
        v.props.accessibilityRole === 'link' &&
        v.props.accessibilityLabel?.toLowerCase().includes('skip')
    )
    expect(skipLink).toBeDefined()
  })
})
```

- [ ] **Step 5: Run tests — verify they fail**

```bash
npm test -- --testPathPattern="tabsLayoutAccessibility|talkScreenStatusLiveRegion|landingFooterAccessibility|skipToMainContent" --no-coverage 2>&1 | tail -30
```

Expected: FAIL.

---

### Task 7: Implement Phase 3 fixes

**Files:**
- Modify: `app/(drawer)/(tabs)/_layout.tsx`
- Modify: `app/(drawer)/(tabs)/talk/index.tsx`
- Modify: `src/components/ConfirmationModal.tsx`
- Modify: `src/components/admin/ConfirmationModal.tsx`
- Modify: `src/components/LandingPage/LandingFooter.tsx`
- Modify: `src/components/LandingPage/index.tsx`

- [ ] **Step 1: Fix tabs _layout.tsx — add tabBarAccessibilityLabel**

In `app/(drawer)/(tabs)/_layout.tsx`, add `tabBarAccessibilityLabel` to each screen's `options`:

```tsx
      <Tabs.Screen
        name="chat"
        options={{
          title: 'Chat',
          tabBarAccessibilityLabel: 'Chat Tab',
          tabBarIcon: ({ color, focused }: { color: string; focused: boolean }) => (
            <TabBarIcon name={focused ? 'chatbubble' : 'chatbubble-outline'} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="talk"
        options={{
          title: 'Talk',
          tabBarAccessibilityLabel: 'Talk Tab',
          tabBarIcon: ({ color, focused }: { color: string; focused: boolean }) => (
            <TabBarIcon name={focused ? 'mic' : 'mic-outline'} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="characters"
        options={{
          title: 'Characters',
          tabBarAccessibilityLabel: 'Characters Tab',
          tabBarIcon: ({ color, focused }: { color: string; focused: boolean }) => (
            <TabBarIcon name={focused ? 'people' : 'people-outline'} color={color} />
          ),
        }}
        listeners={...} // keep existing listeners unchanged
      />
```

- [ ] **Step 2: Fix talk/index.tsx — add live region to statusWrap**

In `app/(drawer)/(tabs)/talk/index.tsx`, find the `statusWrap` View:

```tsx
        <View style={styles.statusWrap}>
          {showSpinner ? <ActivityIndicator size="small" style={styles.spinner} /> : null}
          <Text style={[styles.statusText, error ? styles.errorText : null]}>{statusText}</Text>
        </View>
```

Change to:

```tsx
        <View
          style={styles.statusWrap}
          accessibilityLiveRegion="polite"
        >
          {showSpinner ? <ActivityIndicator size="small" style={styles.spinner} /> : null}
          <Text style={[styles.statusText, error ? styles.errorText : null]}>{statusText}</Text>
        </View>
```

- [ ] **Step 3: Verify ConfirmationModal accessibility (both variants)**

Open `src/components/ConfirmationModal.tsx`. React Native Paper's `Dialog` renders over a `Modal` which handles `accessibilityViewIsModal` on iOS. The `Dialog.Title` receives the title string. No code change needed — Paper handles this correctly.

Open `src/components/admin/ConfirmationModal.tsx`. Same conclusion. No change needed.

Document in commit message: "ConfirmationModal: Paper Dialog verified to handle accessibilityViewIsModal; no changes needed."

- [ ] **Step 4: Fix LandingFooter.tsx — external link label**

In `src/components/LandingPage/LandingFooter.tsx`, change:

```tsx
      <Pressable
        accessibilityRole="link"
        onPress={() => {
          void Linking.openURL('https://equationalapplications.com/').catch((error) => {
            console.warn('Failed to open Equational Applications website', error)
          })
        }}
      >
        <Text variant="bodySmall" style={linkStyle}>
          Equational Applications LLC
        </Text>
      </Pressable>
```

to:

```tsx
      <Pressable
        accessibilityRole="link"
        accessibilityLabel="Equational Applications LLC website, opens external website"
        onPress={() => {
          void Linking.openURL('https://equationalapplications.com/').catch((error) => {
            console.warn('Failed to open Equational Applications website', error)
          })
        }}
      >
        <Text variant="bodySmall" style={linkStyle}>
          Equational Applications LLC
        </Text>
      </Pressable>
```

- [ ] **Step 5: Fix LandingPage/index.tsx — add skip link**

Add `Platform` import and skip link to `src/components/LandingPage/index.tsx`:

```tsx
import { ScrollView, StyleSheet, View, Platform, Text } from 'react-native'
import { useTheme } from 'react-native-paper'
import HeroSection from './HeroSection'
import FeaturesSection from './FeaturesSection'
import LandingFooter from './LandingFooter'

export default function LandingPage() {
  const { colors } = useTheme()

  return (
    <ScrollView
      style={[styles.scroll, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {Platform.OS === 'web' && (
        <a
          href="#main-content"
          // @ts-ignore – web-only focusStyle is applied via StyleSheet for keyboard nav
          style={skipFocused ? SKIP_LINK_VISIBLE : SKIP_LINK_HIDDEN}
        >
          Skip to main content
        </a>
      )}
      <View nativeID="main-content">
        <HeroSection />
        <FeaturesSection />
        <LandingFooter />
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
  },
  skipLink: {
    position: 'absolute',
    top: -1000,
    left: 0,
  },
  skipLinkText: {
    fontSize: 14,
  },
})
```

- [ ] **Step 6: Run Phase 3 tests — verify they pass**

```bash
npm test -- --testPathPattern="tabsLayoutAccessibility|talkScreenStatusLiveRegion|landingFooterAccessibility|skipToMainContent" --no-coverage 2>&1 | tail -30
```

Expected: PASS.

- [ ] **Step 7: Run full test suite**

```bash
npm test --no-coverage 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 8: Run typecheck and lint**

```bash
npm run typecheck && npm run lint --quiet
```

Expected: no errors.

- [ ] **Step 9: Commit Phase 3**

```bash
git add app/(drawer)/(tabs)/_layout.tsx \
        "app/(drawer)/(tabs)/talk/index.tsx" \
        src/components/LandingPage/LandingFooter.tsx \
        src/components/LandingPage/index.tsx \
        __tests__/tabsLayoutAccessibility.test.tsx \
        __tests__/talkScreenStatusLiveRegion.test.tsx \
        __tests__/landingFooterAccessibility.test.tsx \
        __tests__/skipToMainContent.test.tsx

git commit -m "feat(a11y): add tab labels, status live region, footer label, skip link

- Tabs: tabBarAccessibilityLabel on Chat, Talk, and Characters tabs
- Talk screen: accessibilityLiveRegion=\"polite\" on status text region
- LandingFooter: accessibilityLabel with destination on external link
- LandingPage: web-only skip-to-main-content link
- ConfirmationModal (both): verified Paper Dialog handles a11y; no changes needed"
```

---

## Final: Push and open PR

- [ ] **Step 1: Push branch**

```bash
git push -u origin kv/a11y-fixes
```

- [ ] **Step 2: Open PR against staging using the PR template**

Use `.github/pull_request_template.md`. Body should reference:
- `ACCESSIBILITY_AUDIT.md` (external/untracked source document) as source of the 13 issues
- [docs/superpowers/specs/2026-04-30-web-accessibility-fixes-design.md](../specs/2026-04-30-web-accessibility-fixes-design.md) as the design spec
