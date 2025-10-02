import { supabaseClient, Database } from '../config/supabaseClient'

// Types for character data
export type Character = Database['public']['Tables']['characters']['Row']
export type CharacterInsert = Database['public']['Tables']['characters']['Insert']
export type CharacterUpdate = Database['public']['Tables']['characters']['Update']

// Legacy character interface for compatibility
export interface LegacyCharacter {
    id: string
    name: string
    avatar: string
    appearance: string
    traits: string
    emotions: string
    isCharacterPublic: boolean
    context: string
}

/**
 * Get all characters for the current user
 */
export const getUserCharacters = async (): Promise<Character[]> => {
    const { data: { user } } = await supabaseClient.auth.getUser()

    if (!user) {
        return []
    }

    const { data, error } = await supabaseClient
        .from('characters')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })

    if (error) {
        console.error('Error fetching user characters:', error)
        return []
    }

    return data || []
}

/**
 * Get all public characters
 */
export const getPublicCharacters = async (): Promise<Character[]> => {
    const { data, error } = await supabaseClient
        .from('characters')
        .select('*')
        .eq('is_public', true)
        .order('created_at', { ascending: false })

    if (error) {
        console.error('Error fetching public characters:', error)
        return []
    }

    return data || []
}

/**
 * Get a specific character by ID
 */
export const getCharacter = async (id: string, userId?: string): Promise<Character | null> => {
    const { data, error } = await supabaseClient
        .from('characters')
        .select('*')
        .eq('id', id)
        .single()

    if (error) {
        console.error('Error fetching character:', error)
        return null
    }

    return data
}

/**
 * Create a new character
 */
export const createCharacter = async (character: Omit<CharacterInsert, 'user_id'>): Promise<Character | null> => {
    const { data: { user } } = await supabaseClient.auth.getUser()

    if (!user) {
        throw new Error('No authenticated user')
    }

    const { data, error } = await supabaseClient
        .from('characters')
        .insert({
            ...character,
            user_id: user.id,
        })
        .select()
        .single()

    if (error) {
        console.error('Error creating character:', error)
        throw error
    }

    return data
}

/**
 * Update an existing character
 */
export const updateCharacter = async (id: string, updates: CharacterUpdate): Promise<Character | null> => {
    const { data: { user } } = await supabaseClient.auth.getUser()

    if (!user) {
        throw new Error('No authenticated user')
    }

    const { data, error } = await supabaseClient
        .from('characters')
        .update(updates)
        .eq('id', id)
        .eq('user_id', user.id) // Ensure user can only update their own characters
        .select()
        .single()

    if (error) {
        console.error('Error updating character:', error)
        throw error
    }

    return data
}

/**
 * Delete a character
 */
export const deleteCharacter = async (id: string): Promise<void> => {
    const { data: { user } } = await supabaseClient.auth.getUser()

    if (!user) {
        throw new Error('No authenticated user')
    }

    const { error } = await supabaseClient
        .from('characters')
        .delete()
        .eq('id', id)
        .eq('user_id', user.id) // Ensure user can only delete their own characters

    if (error) {
        console.error('Error deleting character:', error)
        throw error
    }
}

/**
 * Create a new character using the legacy Firebase function approach
 */
export const createNewCharacter = async (): Promise<{ id: string }> => {
    const character = await createCharacter({
        name: 'New Character',
        appearance: 'A mysterious figure with an intriguing presence.',
        traits: 'Curious, intelligent, and thoughtful.',
        emotions: 'Calm and collected, with hints of excitement.',
        context: 'A helpful companion ready for meaningful conversations.',
        is_public: false,
    })

    if (!character) {
        throw new Error('Failed to create character')
    }

    return { id: character.id }
}

/**
 * Convert Supabase character to legacy format for compatibility
 */
export const toLegacyCharacter = (character: Character): LegacyCharacter => {
    return {
        id: character.id,
        name: character.name,
        avatar: character.avatar_url || '',
        appearance: character.appearance || '',
        traits: character.traits || '',
        emotions: character.emotions || '',
        isCharacterPublic: character.is_public,
        context: character.context || '',
    }
}

/**
 * Convert legacy character to Supabase format
 */
export const fromLegacyCharacter = (legacy: LegacyCharacter): Omit<CharacterInsert, 'user_id'> => {
    return {
        name: legacy.name,
        avatar_url: legacy.avatar || null,
        appearance: legacy.appearance || null,
        traits: legacy.traits || null,
        emotions: legacy.emotions || null,
        context: legacy.context || null,
        is_public: legacy.isCharacterPublic,
    }
}

/**
 * Subscribe to user's character changes
 */
export const subscribeToUserCharacters = (
    callback: (characters: Character[]) => void
) => {
    let currentUserId: string | null = null

    // Set up auth state listener
    const authSubscription = supabaseClient.auth.onAuthStateChange(async (event, session) => {
        if (session?.user) {
            currentUserId = session.user.id

            // Get initial characters
            const characters = await getUserCharacters()
            callback(characters)
        } else {
            currentUserId = null
            callback([])
        }
    })

    // Set up real-time subscription for character changes
    const charactersSubscription = supabaseClient
        .channel('user-characters-changes')
        .on(
            'postgres_changes',
            {
                event: '*',
                schema: 'public',
                table: 'characters',
                filter: currentUserId ? `user_id=eq.${currentUserId}` : undefined,
            },
            async () => {
                // Refetch all characters when any change occurs
                const characters = await getUserCharacters()
                callback(characters)
            }
        )
        .subscribe()

    // Return cleanup function
    return () => {
        authSubscription.data.subscription?.unsubscribe()
        charactersSubscription.unsubscribe()
    }
}

/**
 * Subscribe to a specific character's changes
 */
export const subscribeToCharacter = (
    characterId: string,
    callback: (character: Character | null) => void
) => {
    // Get initial character data
    getCharacter(characterId).then(callback)

    // Set up real-time subscription
    const subscription = supabaseClient
        .channel(`character-${characterId}-changes`)
        .on(
            'postgres_changes',
            {
                event: '*',
                schema: 'public',
                table: 'characters',
                filter: `id=eq.${characterId}`,
            },
            (payload) => {
                if (payload.eventType === 'DELETE') {
                    callback(null)
                } else {
                    callback(payload.new as Character)
                }
            }
        )
        .subscribe()

    // Return cleanup function
    return () => {
        subscription.unsubscribe()
    }
}