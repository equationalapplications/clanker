interface CharacterFields {
    name?: string | null
    appearance?: string | null
    traits?: string | null
    emotions?: string | null
}

const STYLE_SUFFIX =
    'Clean digital art style, avatar portrait, simple background, centered face, high quality.'

/**
 * Build an image generation prompt from character attributes.
 * Only includes fields that have non-empty values.
 */
export function buildImagePrompt(character: CharacterFields): string {
    const parts: string[] = []

    if (character.name?.trim()) {
        parts.push(`Character portrait of ${character.name.trim()}`)
    } else {
        parts.push('Character portrait')
    }

    if (character.appearance?.trim()) {
        parts.push(`Appearance: ${character.appearance.trim()}`)
    }

    if (character.traits?.trim()) {
        parts.push(`Personality: ${character.traits.trim()}`)
    }

    if (character.emotions?.trim()) {
        parts.push(`Mood: ${character.emotions.trim()}`)
    }

    return `${parts.join('. ')}. ${STYLE_SUFFIX}`
}
