import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react'
import {
  COOKIE_POLICY_VERSION,
  CONSENT_TTL_MS,
  CookieCategory,
  CookieConsentRecord,
  defaultAcceptChoices,
  defaultRejectChoices,
} from '~/utilities/cookieConsentTypes'
import {
  readConsent,
  writeConsent,
} from '~/utilities/cookieConsentStorage.web'

interface ConsentApi {
  isBannerVisible: boolean
  isPreferencesOpen: boolean
  choices: Record<CookieCategory, boolean>
  policyVersion: number
  acceptAll: () => void
  rejectAll: () => void
  openPreferences: () => void
  closePreferences: () => void
  savePreferences: (next: Partial<Record<CookieCategory, boolean>>) => void
  canUse: (category: CookieCategory) => boolean
}

const CookieConsentContext = createContext<ConsentApi | null>(null)

function buildRecord(choices: Record<CookieCategory, boolean>): CookieConsentRecord {
  const now = Date.now()
  return {
    policyVersion: COOKIE_POLICY_VERSION,
    consentedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + CONSENT_TTL_MS).toISOString(),
    regionMode: 'opt-in-strict',
    choices: { ...choices, necessary: true },
  }
}

export function CookieConsentProvider({ children }: { children: React.ReactNode }) {
  const [record, setRecord] = useState<CookieConsentRecord | null>(() => readConsent())
  const [isPreferencesOpen, setPreferencesOpen] = useState(false)

  const persist = useCallback((choices: Record<CookieCategory, boolean>) => {
    const next = buildRecord(choices)
    writeConsent(next)
    setRecord(next)
  }, [])

  const acceptAll = useCallback(() => {
    persist(defaultAcceptChoices())
    setPreferencesOpen(false)
  }, [persist])

  const rejectAll = useCallback(() => {
    persist(defaultRejectChoices())
    setPreferencesOpen(false)
  }, [persist])

  const openPreferences = useCallback(() => setPreferencesOpen(true), [])
  const closePreferences = useCallback(() => setPreferencesOpen(false), [])

  const savePreferences = useCallback(
    (next: Partial<Record<CookieCategory, boolean>>) => {
      const base = record?.choices ?? defaultRejectChoices()
      persist({ ...base, ...next, necessary: true })
      setPreferencesOpen(false)
    },
    [persist, record],
  )

  const choices = useMemo(
    () => record?.choices ?? defaultRejectChoices(),
    [record],
  )
  const canUse = useCallback(
    (category: CookieCategory) => (record ? choices[category] === true : category === 'necessary'),
    [record, choices],
  )

  const value = useMemo<ConsentApi>(
    () => ({
      isBannerVisible: record === null,
      isPreferencesOpen,
      choices,
      policyVersion: COOKIE_POLICY_VERSION,
      acceptAll,
      rejectAll,
      openPreferences,
      closePreferences,
      savePreferences,
      canUse,
    }),
    [
      record,
      isPreferencesOpen,
      choices,
      acceptAll,
      rejectAll,
      openPreferences,
      closePreferences,
      savePreferences,
      canUse,
    ],
  )

  return <CookieConsentContext.Provider value={value}>{children}</CookieConsentContext.Provider>
}

export function useCookieConsent(): ConsentApi {
  const ctx = useContext(CookieConsentContext)
  if (!ctx) throw new Error('useCookieConsent must be used within CookieConsentProvider')
  return ctx
}
