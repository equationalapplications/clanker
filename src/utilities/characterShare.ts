import QRCode from 'qrcode'

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

export const buildCharacterQrCodeDataUrl = async (shareUrl: string) => {
  try {
    return await QRCode.toDataURL(shareUrl, {
      width: 512,
      margin: 1,
      errorCorrectionLevel: 'M',
    })
  } catch {
    throw new Error('Unable to generate QR code for this character link.')
  }
}
