import { loadDefaultCharacterAvatar } from '~/utilities/loadDefaultAvatar'

/**
 * Thin indirection around the default avatar loader so machine/service logic can
 * mock this dependency without importing Expo file-system/asset modules directly.
 */
export const loadDefaultAvatarBase64 = async (): Promise<string> => {
  return loadDefaultCharacterAvatar()
}
