import React, { useState } from 'react'
import { Avatar } from 'react-native-paper'
import { MaterialIcons } from '@expo/vector-icons'
import { defaultAvatarUrl } from '../config/constants'

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
    showFallback = true
}: CharacterAvatarProps) {
    const [imageError, setImageError] = useState(false)

    // Use the provided image if available and no error occurred
    if (imageUrl && !imageError) {
        return (
            <Avatar.Image
                size={size}
                source={{ uri: imageUrl }}
                onError={() => setImageError(true)}
            />
        )
    }

    // If we have a character name, show initials
    if (characterName && showFallback) {
        const initials = characterName
            .split(' ')
            .map(word => word.charAt(0))
            .join('')
            .substring(0, 2)
            .toUpperCase()

        if (initials) {
            return (
                <Avatar.Text
                    size={size}
                    label={initials}
                />
            )
        }
    }

    // Show icon placeholder as final fallback
    if (showFallback) {
        return (
            <Avatar.Icon
                size={size}
                icon="account"
            />
        )
    }

    // Use default gravatar if no other options
    return (
        <Avatar.Image
            size={size}
            source={{ uri: defaultAvatarUrl }}
        />
    )
}