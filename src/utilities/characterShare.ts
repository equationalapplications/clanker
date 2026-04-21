const DEFAULT_CHARACTER_SHARE_BASE_URL = 'https://clanker.app'

const normalizeBaseUrl = (url: string) => url.replace(/\/+$/, '')

const getCharacterShareBaseUrl = () => {
  const configured = process.env.EXPO_PUBLIC_CHARACTER_SHARE_BASE_URL?.trim()
  if (configured) {
    return normalizeBaseUrl(configured)
  }

  return DEFAULT_CHARACTER_SHARE_BASE_URL
}

export const buildCharacterShareUrl = (cloudCharacterId: string) =>
  `${getCharacterShareBaseUrl()}/characters/shared/${encodeURIComponent(cloudCharacterId)}`

export const buildNativeCharacterShareLink = (cloudCharacterId: string) =>
  `com.equationalapplications.clanker://characters/shared/${encodeURIComponent(cloudCharacterId)}`

export const buildCharacterQrCodeUrl = (shareUrl: string) =>
  `https://api.qrserver.com/v1/create-qr-code/?size=512x512&data=${encodeURIComponent(shareUrl)}`
