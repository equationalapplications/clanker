import React, { useEffect, useState } from 'react'
import { Avatar } from 'react-native-paper'
import type { ComponentProps } from 'react'

/**
 * Bundled default. Nothing is written per character: previously every new
 * character stored its own copy of the same 7.6 KB base64 blob, and that blob
 * was an Android adaptive icon whose padding showed as a ring under the
 * circular mask.
 */
const DEFAULT_AVATAR = require('../../assets/default-avatar-1024.webp')

// react-native-paper 5.x does not include `resizeMode` in the type definition
// for Avatar.Image, but the underlying Image component accepts it and it is
// needed to fill the circular mask with non-square sources.
type AvatarImageProps = ComponentProps<typeof Avatar.Image> & { resizeMode?: string }

interface CharacterAvatarProps {
  size?: number
  imageUrl?: string | null
  characterName?: string
  showFallback?: boolean
}

export default function CharacterAvatar({
  size = 100,
  imageUrl,
  characterName = '',
  showFallback = true,
}: CharacterAvatarProps) {
  const [imageError, setImageError] = useState(false)

  // A new URI is a new attempt: without this, one failed load would pin the
  // fallback for the lifetime of the component even after the user picks
  // another image.
  useEffect(() => {
    setImageError(false)
  }, [imageUrl])

  if (imageUrl && !imageError) {
    const AvatarImage = Avatar.Image as React.ComponentType<AvatarImageProps>
    return (
      <AvatarImage
        size={size}
        source={{ uri: imageUrl }}
        // Legacy migrated avatars can be non-square; cover fills the circle
        // instead of letterboxing it.
        resizeMode="cover"
        onError={() => setImageError(true)}
        accessible
        accessibilityLabel={characterName ? `${characterName} avatar` : 'Character avatar'}
      />
    )
  }

  // If we have a character name, show initials
  if (characterName && showFallback) {
    const initials = characterName
      .split(' ')
      .map((word) => word.charAt(0))
      .join('')
      .substring(0, 2)
      .toUpperCase()

    if (initials) {
      return <Avatar.Text size={size} label={initials} accessible accessibilityLabel={`${characterName} avatar`} />
    }
  }

  const AvatarImage = Avatar.Image as React.ComponentType<AvatarImageProps>
  return (
    <AvatarImage
      size={size}
      source={DEFAULT_AVATAR}
      resizeMode="cover"
      accessible
      accessibilityLabel="Character avatar"
    />
  )
}
