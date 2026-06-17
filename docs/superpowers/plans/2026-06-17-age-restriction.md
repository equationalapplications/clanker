# Age Restriction (18+) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce 18+ age verification at the terms acceptance gate using native OS APIs on mobile and a manual date-of-birth picker on web and as a fallback.

**Architecture:** A `useAgeVerification` hook owns all platform branching and native API calls; `accept-terms.tsx` wires the hook and conditionally renders `<ManualDobPicker>` when native verification is unavailable. No XState machine changes required — age verification is a pre-flight check that fires before the existing `ACCEPT_TERMS` event.

**Tech Stack:** `expo-age-range@^56.0.5` (already installed), `react-native` Platform API, `react-native-paper` (TextInput, Button), `@testing-library/react-native`, `jest-expo`

---

## Spec Reference

`docs/superpowers/specs/2026-06-17-age-restriction-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/hooks/useAgeVerification.ts` | Create | Platform branching, native API calls, fallback state |
| `src/hooks/__tests__/useAgeVerification.test.ts` | Create | Hook unit tests |
| `src/components/ManualDobPicker.tsx` | Create | DOB input UI, age calculation |
| `src/components/__tests__/ManualDobPicker.test.tsx` | Create | Component tests |
| `app/(drawer)/accept-terms.tsx` | Modify | Wire hook, conditional render |
| `src/components/AcceptTerms.tsx` | Modify | Remove age self-attestation from checkbox |

---

## Task 1: `useAgeVerification` hook (TDD)

**Files:**
- Create: `src/hooks/useAgeVerification.ts`
- Create: `src/hooks/__tests__/useAgeVerification.test.ts`

---

- [ ] **Step 1.1: Write the failing tests**

Create `src/hooks/__tests__/useAgeVerification.test.ts`:

```ts
import { renderHook, act } from '@testing-library/react-native'
import { Platform } from 'react-native'
import * as AgeRange from 'expo-age-range'
import { useAgeVerification } from '../useAgeVerification'

jest.mock('expo-age-range', () => ({
  requestAgeRangeAsync: jest.fn(),
  isEligibleForAgeFeaturesAsync: jest.fn(),
}))

const mockRequestAgeRange = AgeRange.requestAgeRangeAsync as jest.Mock
const mockIsEligible = AgeRange.isEligibleForAgeFeaturesAsync as jest.Mock

function setup() {
  const onVerified = jest.fn()
  const onRejected = jest.fn()
  const result = renderHook(() => useAgeVerification({ onVerified, onRejected }))
  return { ...result, onVerified, onRejected }
}

function setVersion(version: string) {
  Object.defineProperty(Platform, 'Version', {
    value: version,
    configurable: true,
    writable: true,
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  __resetJestPlatformOS()
})

describe('web', () => {
  beforeEach(() => __setJestPlatformOS('web'))

  it('sets showDobPicker immediately without calling native APIs', async () => {
    const { result, onVerified, onRejected } = setup()
    await act(() => result.current.verifyAge())
    expect(result.current.showDobPicker).toBe(true)
    expect(result.current.isVerifying).toBe(false)
    expect(mockRequestAgeRange).not.toHaveBeenCalled()
    expect(onVerified).not.toHaveBeenCalled()
    expect(onRejected).not.toHaveBeenCalled()
  })
})

describe('iOS < 26', () => {
  beforeEach(() => {
    __setJestPlatformOS('ios')
    setVersion('17.5')
  })

  it('sets showDobPicker immediately without calling native APIs', async () => {
    const { result, onVerified, onRejected } = setup()
    await act(() => result.current.verifyAge())
    expect(result.current.showDobPicker).toBe(true)
    expect(result.current.isVerifying).toBe(false)
    expect(mockRequestAgeRange).not.toHaveBeenCalled()
    expect(onVerified).not.toHaveBeenCalled()
    expect(onRejected).not.toHaveBeenCalled()
  })
})

describe('iOS >= 26', () => {
  beforeEach(() => {
    __setJestPlatformOS('ios')
    setVersion('26.0')
  })

  it('calls onVerified when isEligible is false (unregulated region)', async () => {
    mockIsEligible.mockResolvedValue(false)
    const { result, onVerified } = setup()
    await act(() => result.current.verifyAge())
    expect(onVerified).toHaveBeenCalledTimes(1)
    expect(mockRequestAgeRange).not.toHaveBeenCalled()
    expect(result.current.isVerifying).toBe(false)
  })

  it('calls onVerified when isEligible is null and lowerBound >= 18', async () => {
    mockIsEligible.mockResolvedValue(null)
    mockRequestAgeRange.mockResolvedValue({ lowerBound: 18, upperBound: null })
    const { result, onVerified } = setup()
    await act(() => result.current.verifyAge())
    expect(onVerified).toHaveBeenCalledTimes(1)
    expect(result.current.isVerifying).toBe(false)
  })

  it('calls onVerified when isEligible is true and lowerBound >= 18', async () => {
    mockIsEligible.mockResolvedValue(true)
    mockRequestAgeRange.mockResolvedValue({ lowerBound: 18, upperBound: null })
    const { result, onVerified } = setup()
    await act(() => result.current.verifyAge())
    expect(onVerified).toHaveBeenCalledTimes(1)
    expect(result.current.isVerifying).toBe(false)
  })

  it('calls onRejected when lowerBound < 18', async () => {
    mockIsEligible.mockResolvedValue(true)
    mockRequestAgeRange.mockResolvedValue({ lowerBound: 17, upperBound: 17 })
    const { result, onRejected } = setup()
    await act(() => result.current.verifyAge())
    expect(onRejected).toHaveBeenCalledTimes(1)
    expect(result.current.isVerifying).toBe(false)
  })

  it('shows DOB picker when requestAgeRangeAsync throws', async () => {
    mockIsEligible.mockResolvedValue(true)
    mockRequestAgeRange.mockRejectedValue(new Error('not signed in'))
    const { result, onVerified, onRejected } = setup()
    await act(() => result.current.verifyAge())
    expect(result.current.showDobPicker).toBe(true)
    expect(result.current.isVerifying).toBe(false)
    expect(onVerified).not.toHaveBeenCalled()
    expect(onRejected).not.toHaveBeenCalled()
  })

  it('falls through to requestAgeRangeAsync when isEligibleForAgeFeaturesAsync throws', async () => {
    mockIsEligible.mockRejectedValue(new Error('service error'))
    mockRequestAgeRange.mockResolvedValue({ lowerBound: 18, upperBound: null })
    const { result, onVerified } = setup()
    await act(() => result.current.verifyAge())
    // isEligible error treated as unknown — falls through to requestAgeRangeAsync
    expect(mockRequestAgeRange).toHaveBeenCalledTimes(1)
    expect(onVerified).toHaveBeenCalledTimes(1)
  })
})

describe('Android', () => {
  beforeEach(() => __setJestPlatformOS('android'))

  it('calls onVerified when lowerBound >= 18', async () => {
    mockRequestAgeRange.mockResolvedValue({ lowerBound: 18, upperBound: null })
    const { result, onVerified } = setup()
    await act(() => result.current.verifyAge())
    expect(onVerified).toHaveBeenCalledTimes(1)
    expect(mockIsEligible).not.toHaveBeenCalled()
    expect(result.current.isVerifying).toBe(false)
  })

  it('calls onRejected when lowerBound < 18', async () => {
    mockRequestAgeRange.mockResolvedValue({ lowerBound: 17, upperBound: 17 })
    const { result, onRejected } = setup()
    await act(() => result.current.verifyAge())
    expect(onRejected).toHaveBeenCalledTimes(1)
    expect(result.current.isVerifying).toBe(false)
  })

  it('shows DOB picker when requestAgeRangeAsync throws', async () => {
    mockRequestAgeRange.mockRejectedValue(new Error('play services error'))
    const { result, onVerified, onRejected } = setup()
    await act(() => result.current.verifyAge())
    expect(result.current.showDobPicker).toBe(true)
    expect(result.current.isVerifying).toBe(false)
    expect(onVerified).not.toHaveBeenCalled()
    expect(onRejected).not.toHaveBeenCalled()
  })
})

describe('handleDobResult', () => {
  it('calls onVerified when isAdult is true', () => {
    const { result, onVerified } = setup()
    act(() => result.current.handleDobResult(true))
    expect(onVerified).toHaveBeenCalledTimes(1)
  })

  it('calls onRejected when isAdult is false', () => {
    const { result, onRejected } = setup()
    act(() => result.current.handleDobResult(false))
    expect(onRejected).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 1.2: Run tests to confirm they fail**

```bash
npx jest --testPathPattern="useAgeVerification" -v
```

Expected: FAIL — `Cannot find module '../useAgeVerification'`

- [ ] **Step 1.3: Implement `useAgeVerification.ts`**

Create `src/hooks/useAgeVerification.ts`:

```ts
import { useState } from 'react'
import { Platform } from 'react-native'
import * as AgeRange from 'expo-age-range'

interface UseAgeVerificationProps {
  onVerified: () => void
  onRejected: () => void
}

export function useAgeVerification({ onVerified, onRejected }: UseAgeVerificationProps) {
  const [isVerifying, setIsVerifying] = useState(false)
  const [showDobPicker, setShowDobPicker] = useState(false)

  const verifyAge = async () => {
    setIsVerifying(true)

    // Web and iOS < 26: requestAgeRangeAsync silently returns lowerBound: 18 on these
    // platforms — must intercept before calling the API.
    // Note: iOS 26 is NOT a typo. Apple switched to year-based versioning at WWDC 2025.
    const iosVersion = Platform.OS === 'ios' ? parseInt(String(Platform.Version), 10) : Infinity
    if (Platform.OS === 'web' || (Platform.OS === 'ios' && iosVersion < 26)) {
      setIsVerifying(false)
      setShowDobPicker(true)
      return
    }

    try {
      if (Platform.OS === 'ios') {
        try {
          const isEligible = await AgeRange.isEligibleForAgeFeaturesAsync()
          if (isEligible === false) {
            setIsVerifying(false)
            onVerified()
            return
          }
          // null or true: fall through to requestAgeRangeAsync
        } catch {
          // isEligibleForAgeFeaturesAsync threw — treat as unknown, fall through
        }
      }

      const ageRange = await AgeRange.requestAgeRangeAsync({ threshold1: 18 })

      setIsVerifying(false)
      if (ageRange.lowerBound >= 18) {
        onVerified()
      } else {
        onRejected()
      }
    } catch {
      setIsVerifying(false)
      setShowDobPicker(true)
    }
  }

  const handleDobResult = (isAdult: boolean) => {
    if (isAdult) {
      onVerified()
    } else {
      onRejected()
    }
  }

  return { verifyAge, isVerifying, showDobPicker, handleDobResult }
}
```

- [ ] **Step 1.4: Run tests to confirm they pass**

```bash
npx jest --testPathPattern="useAgeVerification" -v
```

Expected: All tests PASS

- [ ] **Step 1.5: Commit**

```bash
git add src/hooks/useAgeVerification.ts src/hooks/__tests__/useAgeVerification.test.ts
git commit -m "feat: add useAgeVerification hook with platform branching"
```

---

## Task 2: `ManualDobPicker` component (TDD)

**Files:**
- Create: `src/components/ManualDobPicker.tsx`
- Create: `src/components/__tests__/ManualDobPicker.test.tsx`

The component uses three controlled `TextInput` fields (Month 1–12, Day 1–31, Year 4-digit) and a "Continue" button. A dropdown upgrade can follow; the compliance logic is in the age calculation.

---

- [ ] **Step 2.1: Write the failing tests**

Create `src/components/__tests__/ManualDobPicker.test.tsx`:

```tsx
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react-native'
import { ManualDobPicker } from '../ManualDobPicker'

function fillDob(month: string, day: string, year: string) {
  fireEvent.changeText(screen.getByTestId('dob-month'), month)
  fireEvent.changeText(screen.getByTestId('dob-day'), day)
  fireEvent.changeText(screen.getByTestId('dob-year'), year)
}

describe('ManualDobPicker', () => {
  it('renders month, day, year inputs and a submit button', () => {
    render(<ManualDobPicker onComplete={jest.fn()} />)
    expect(screen.getByTestId('dob-month')).toBeTruthy()
    expect(screen.getByTestId('dob-day')).toBeTruthy()
    expect(screen.getByTestId('dob-year')).toBeTruthy()
    expect(screen.getByTestId('dob-submit')).toBeTruthy()
  })

  it('calls onComplete(true) for a user who is clearly 18+', () => {
    const onComplete = jest.fn()
    render(<ManualDobPicker onComplete={onComplete} />)
    fillDob('1', '1', '1990')
    fireEvent.press(screen.getByTestId('dob-submit'))
    expect(onComplete).toHaveBeenCalledWith(true)
  })

  it('calls onComplete(false) for a user who is clearly under 18', () => {
    const onComplete = jest.fn()
    // Use a fixed year that is always < 18 years ago
    const minorYear = String(new Date().getFullYear() - 10)
    render(<ManualDobPicker onComplete={onComplete} />)
    fillDob('6', '15', minorYear)
    fireEvent.press(screen.getByTestId('dob-submit'))
    expect(onComplete).toHaveBeenCalledWith(false)
  })

  it('calls onComplete(true) when user turns 18 exactly today', () => {
    const today = new Date()
    const onComplete = jest.fn()
    const birthYear = String(today.getFullYear() - 18)
    const birthMonth = String(today.getMonth() + 1) // getMonth() is 0-indexed
    const birthDay = String(today.getDate())
    render(<ManualDobPicker onComplete={onComplete} />)
    fillDob(birthMonth, birthDay, birthYear)
    fireEvent.press(screen.getByTestId('dob-submit'))
    expect(onComplete).toHaveBeenCalledWith(true)
  })

  it('calls onComplete(false) when birthday is tomorrow 18 years ago (not yet 18)', () => {
    const today = new Date()
    const onComplete = jest.fn()
    // tomorrow's date, 18 years ago → birthday not yet reached → still 17
    const futureDate = new Date(today.getFullYear() - 18, today.getMonth(), today.getDate() + 1)
    render(<ManualDobPicker onComplete={onComplete} />)
    fillDob(
      String(futureDate.getMonth() + 1),
      String(futureDate.getDate()),
      String(futureDate.getFullYear()),
    )
    fireEvent.press(screen.getByTestId('dob-submit'))
    expect(onComplete).toHaveBeenCalledWith(false)
  })

  it('does not call onComplete when fields are empty', () => {
    const onComplete = jest.fn()
    render(<ManualDobPicker onComplete={onComplete} />)
    fireEvent.press(screen.getByTestId('dob-submit'))
    expect(onComplete).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2.2: Run tests to confirm they fail**

```bash
npx jest --testPathPattern="ManualDobPicker" -v
```

Expected: FAIL — `Cannot find module '../ManualDobPicker'`

- [ ] **Step 2.3: Implement `ManualDobPicker.tsx`**

Create `src/components/ManualDobPicker.tsx`:

```tsx
import { useState } from 'react'
import { StyleSheet, View, Alert } from 'react-native'
import { TextInput, Button, Text } from 'react-native-paper'

interface ManualDobPickerProps {
  onComplete: (isAdult: boolean) => void
}

function calculateAge(year: number, month: number, day: number): number {
  const today = new Date()
  const birth = new Date(year, month - 1, day) // month is 1-indexed from inputs
  let age = today.getFullYear() - birth.getFullYear()
  const m = today.getMonth() - birth.getMonth()
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--
  return age
}

export function ManualDobPicker({ onComplete }: ManualDobPickerProps) {
  const [month, setMonth] = useState('')
  const [day, setDay] = useState('')
  const [year, setYear] = useState('')

  const handleSubmit = () => {
    const m = parseInt(month, 10)
    const d = parseInt(day, 10)
    const y = parseInt(year, 10)

    if (!m || !d || !y || year.length !== 4) return

    const age = calculateAge(y, m, d)
    onComplete(age >= 18)
  }

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Enter your date of birth to continue.</Text>
      <View style={styles.row}>
        <TextInput
          testID="dob-month"
          label="Month"
          value={month}
          onChangeText={setMonth}
          keyboardType="number-pad"
          maxLength={2}
          style={styles.field}
        />
        <TextInput
          testID="dob-day"
          label="Day"
          value={day}
          onChangeText={setDay}
          keyboardType="number-pad"
          maxLength={2}
          style={styles.field}
        />
        <TextInput
          testID="dob-year"
          label="Year"
          value={year}
          onChangeText={setYear}
          keyboardType="number-pad"
          maxLength={4}
          style={styles.yearField}
        />
      </View>
      <Button testID="dob-submit" mode="contained" onPress={handleSubmit} style={styles.button}>
        Continue
      </Button>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  heading: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 24,
  },
  row: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 24,
  },
  field: {
    width: 70,
  },
  yearField: {
    width: 90,
  },
  button: {
    width: '100%',
  },
})
```

- [ ] **Step 2.4: Run tests to confirm they pass**

```bash
npx jest --testPathPattern="ManualDobPicker" -v
```

Expected: All tests PASS

- [ ] **Step 2.5: Commit**

```bash
git add src/components/ManualDobPicker.tsx src/components/__tests__/ManualDobPicker.test.tsx
git commit -m "feat: add ManualDobPicker component with age calculation"
```

---

## Task 3: Wire `accept-terms.tsx`

**Files:**
- Modify: `app/(drawer)/accept-terms.tsx`

No tests required — this is a wiring task; hook and component are already tested. Manual smoke test covers it.

---

- [ ] **Step 3.1: Replace `accept-terms.tsx`**

Replace the full content of `app/(drawer)/accept-terms.tsx`:

```tsx
import { useEffect } from 'react'
import { StyleSheet, View, Alert } from 'react-native'
import { useLocalSearchParams, router } from 'expo-router'
import { useSelector } from '@xstate/react'

import { AcceptTerms } from '~/components/AcceptTerms'
import { ManualDobPicker } from '~/components/ManualDobPicker'
import { useTermsMachine, useAuthMachine } from '~/hooks/useMachines'
import { useAgeVerification } from '~/hooks/useAgeVerification'
import { TERMS } from '~/config/termsConfig'

export default function AcceptTermsScreen() {
  const params = useLocalSearchParams()
  const termsService = useTermsMachine()
  const authService = useAuthMachine()
  const isUpdate = params.isUpdate === 'true'

  const { accepted, accepting, error } = useSelector(termsService, (state) => ({
    accepted: state.matches('accepted'),
    accepting: state.matches('accepting'),
    error: state.context.error,
  }))

  useEffect(() => {
    if (accepted) {
      authService.send({
        type: 'TERMS_ACCEPTED_LOCAL',
        termsVersion: TERMS.version,
        termsAcceptedAt: new Date().toISOString(),
      })
      router.replace('/')
    }
  }, [accepted, authService])

  const handleVerifiedAdult = () => {
    termsService.send({ type: 'ACCEPT_TERMS', isUpdate })
  }

  const handleRejectedMinor = () => {
    Alert.alert('Age Restriction', 'This app is for users 18 and older.')
    authService.send({ type: 'SIGN_OUT' })
  }

  const { verifyAge, isVerifying, showDobPicker, handleDobResult } = useAgeVerification({
    onVerified: handleVerifiedAdult,
    onRejected: handleRejectedMinor,
  })

  const handleCanceled = () => {
    authService.send({ type: 'SIGN_OUT' })
  }

  if (showDobPicker) {
    return (
      <View style={styles.container}>
        <ManualDobPicker onComplete={handleDobResult} />
      </View>
    )
  }

  return (
    <View style={styles.container}>
      <AcceptTerms
        onAccepted={verifyAge}
        onCanceled={handleCanceled}
        isUpdate={isUpdate}
        accepting={accepting || isVerifying}
        error={error?.message}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
})
```

- [ ] **Step 3.2: Run the full test suite to check for regressions**

```bash
npx jest -v
```

Expected: All existing tests PASS, new hook/component tests PASS

- [ ] **Step 3.3: Commit**

```bash
git add app/(drawer)/accept-terms.tsx
git commit -m "feat: wire useAgeVerification into accept-terms screen"
```

---

## Task 4: Remove age self-attestation from checkbox text

**Files:**
- Modify: `src/components/AcceptTerms.tsx:128-132`

---

- [ ] **Step 4.1: Update checkbox text**

In `src/components/AcceptTerms.tsx`, find this text (around line 129):

```tsx
          I am over 18 years of age and I have read and accept the Terms and Conditions and Privacy
          Policy.
```

Replace with:

```tsx
          I have read and accept the Terms and Conditions and Privacy Policy.
```

- [ ] **Step 4.2: Run the full test suite**

```bash
npx jest -v
```

Expected: All tests PASS

- [ ] **Step 4.3: Commit**

```bash
git add src/components/AcceptTerms.tsx
git commit -m "feat: remove age self-attestation from terms checkbox — enforced by hook"
```

---

## Manual Smoke Test

After all tasks complete, run the app and verify:

**Mobile (iOS 26+):** Tap "I Accept" → native OS age prompt appears → adult response → terms accepted → navigate to `/`

**Mobile (iOS 26+, minor):** Tap "I Accept" → native OS age prompt → minor response → alert "This app is for users 18 and older." → signed out

**Mobile (iOS < 26 or Android error):** Tap "I Accept" → `ManualDobPicker` renders → enter adult DOB → terms accepted

**Web:** Tap "I Accept" → `ManualDobPicker` renders immediately → enter adult DOB → terms accepted

**Web, minor:** Enter minor DOB → alert → signed out
