import { CHARACTER_SHARE_PATH_PREFIX, SITE_BASE } from '~/config/siteConfig'

const normalizeBaseUrl = (url: string) => url.replace(/\/+$/, '')

const getCharacterShareBaseUrl = () => {
  // Note: the native app-link manifests in app.config.ts always use SITE_BASE;
  // overriding this env var makes generated links stop deep-linking into the app.
  const configured = process.env.EXPO_PUBLIC_CHARACTER_SHARE_BASE_URL?.trim()
  if (configured) {
    return normalizeBaseUrl(configured)
  }

  return SITE_BASE
}

export const buildCharacterShareUrl = (cloudCharacterId: string) =>
  `${getCharacterShareBaseUrl()}${CHARACTER_SHARE_PATH_PREFIX}${encodeURIComponent(cloudCharacterId)}`

export const buildNativeCharacterShareLink = (cloudCharacterId: string) =>
  `com.equationalapplications.clanker://${CHARACTER_SHARE_PATH_PREFIX.slice(1)}${encodeURIComponent(cloudCharacterId)}`
