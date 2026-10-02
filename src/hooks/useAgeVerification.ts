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
  const [needsPlayVerification, setNeedsPlayVerification] = useState(false)

  const retryPlayVerification = () => {
    setNeedsPlayVerification(false)
    void verifyAge()
  }

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
            // `false` means Apple confirms Declared Age Range regulation does NOT apply
            // in this region/configuration — NOT that the user is an adult. No verified
            // age signal exists here, so fall back to the manual DOB check rather than
            // waving the user through (ToS A6 promises an age check at sign-up).
            setIsVerifying(false)
            setShowDobPicker(true)
            return
          }
          // null or true: fall through to requestAgeRangeAsync
        } catch {
          // isEligibleForAgeFeaturesAsync threw — treat as unknown, fall through
        }
      }

      if (Platform.OS === 'android') {
        try {
          // Play Age Signals only reports an age range once sharing status is 'SHARED'.
          // 'NOT_SHARED' and null mean no signal is available — fall back to the manual
          // DOB check. 'VERIFICATION_REQUIRED' means Play mandates identity verification
          // (age unknown in a mandatory-verification region): acceptance must stay
          // blocked until the user resolves it in the Play Store. Self-attested DOB must
          // NOT stand in for a mandatory Play verification (CodeRabbit round on PR #783).
          const status = await AgeRange.requestAgeSignalsAccessAsync()
          if (status === 'VERIFICATION_REQUIRED') {
            setIsVerifying(false)
            setNeedsPlayVerification(true)
            return
          }
          if (status !== 'SHARED') {
            setIsVerifying(false)
            setShowDobPicker(true)
            return
          }
        } catch {
          // requestAgeSignalsAccessAsync threw — treat as unknown, fall through
        }
      }

      const ageRange = await AgeRange.requestAgeRangeAsync({ threshold1: 18 })

      setIsVerifying(false)
      const { lowerBound } = ageRange
      if (lowerBound == null) {
        setShowDobPicker(true)
      } else if (lowerBound >= 18) {
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

  return {
    verifyAge,
    isVerifying,
    showDobPicker,
    handleDobResult,
    needsPlayVerification,
    retryPlayVerification,
  }
}
