import { DEFAULT_AVATAR_BASE64 } from './defaultAvatarBase64'

/**
 * Load the default character avatar as a base64-encoded string.
 * The image (assets/adaptive-icon-200x200.webp) is embedded at build time
 * so no filesystem or asset-loader dependencies are needed at runtime.
 */
export async function loadDefaultCharacterAvatar(): Promise<string> {
  return DEFAULT_AVATAR_BASE64
}

