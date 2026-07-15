import { CHARACTER_SHARE_PATH_PREFIX, SITE_BASE } from '~/config/siteConfig'

const normalizeBaseUrl = (url: string) => url.replace(/\/+$/, '')

const getCharacterShareBaseUrl = () => {
  // Note: app.config.ts derives the native app-link host from this same env
  // var, so manifests stay aligned with an override — but the custom host must
  // also serve assetlinks.json / apple-app-site-association for links to
  // deep-link into the app.
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
