import React, { useState } from 'react'
import { Avatar } from 'react-native-paper'
import type { ComponentProps } from 'react'

/**
 * Bundled default. Nothing is written per character: previously every new
 * character stored its own copy of the same 7.6 KB base64 blob, and that blob
 * was an Android adaptive icon whose padding showed as a ring under the
 * circular mask.
 *
 * Exported as a testing contract, not for production use. The bundled-default
 * assertion in `__tests__/characterAvatar.test.tsx` compares `Avatar.Image`'s
 * `source` against this by identity; inlining it back into the component
 * breaks that suite. No production consumer reads it — that is intentional,
 * not dead code.
 */
export const DEFAULT_AVATAR = require('../../assets/default-avatar-1024.webp')

// react-native-paper 5.x does not include `resizeMode` in the type definition
// for Avatar.Image, but the underlying Image component accepts it and it is
// needed to fill the circular mask with non-square sources.
type AvatarImageProps = ComponentProps<typeof Avatar.Image> & { resizeMode?: string }

interface CharacterAvatarProps {
  size?: number
  imageUrl?: string | null
  characterName?: string
}

/**
 * Fallback chain: `imageUrl` → bundled default.
 *
 * There is deliberately no initials branch. Characters with no image row are
 * expected to render the bundled asset — see `characterMachine.ts`'s default
 * character creation and the bundled-default purge in
 * `migrateAvatarsToImageStore`, both of which write no row on purpose. An
 * initials branch ahead of the bundled default made that fallback unreachable
 * for any character with a name, i.e. all of them.
 */
export default function CharacterAvatar({
  size = 100,
  imageUrl,
  characterName = '',
}: CharacterAvatarProps) {
  const [erroredUrl, setErroredUrl] = useState<string | null>(null)
  // Derived: imageError is true only when the current URL matches the one that
  // errored. When imageUrl changes, erroredUrl won't match, so imageError
  // naturally resets — no effect needed.
  const imageError = imageUrl != null && erroredUrl === imageUrl

  const AvatarImage = Avatar.Image as React.ComponentType<AvatarImageProps>

  if (imageUrl && !imageError) {
    return (
      <AvatarImage
        size={size}
        source={{ uri: imageUrl }}
        // Legacy migrated avatars can be non-square; cover fills the circle
        // instead of letterboxing it.
        resizeMode="cover"
        onError={() => {
          setErroredUrl(imageUrl ?? null)
        }}
        accessible
        accessibilityRole="image"
        accessibilityLabel={characterName ? `${characterName} avatar` : 'Character avatar'}
      />
    )
  }

  return (
    <AvatarImage
      size={size}
      source={DEFAULT_AVATAR}
      resizeMode="cover"
      accessible
      accessibilityRole="image"
      accessibilityLabel="Character avatar"
    />
  )
}
