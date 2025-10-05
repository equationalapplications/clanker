import { supabaseClient, Database } from '../config/supabaseClient'

// Types for character data
export type Character = Database['public']['Tables']['yours_brightly_characters']['Row']
export type CharacterInsert = Database['public']['Tables']['yours_brightly_characters']['Insert']
export type CharacterUpdate = Database['public']['Tables']['yours_brightly_characters']['Update']

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
        .from('yours_brightly_characters')
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
        .from('yours_brightly_characters')
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
        .from('yours_brightly_characters')
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
    console.log('🔧 createCharacter starting with data:', character)

    const { data: { user } } = await supabaseClient.auth.getUser()
    console.log('👤 Current user:', user?.id)

    if (!user) {
        console.error('❌ No authenticated user found')
        throw new Error('No authenticated user')
    }

    console.log('💾 Inserting character into Supabase...')
    const { data, error } = await supabaseClient
        .from('yours_brightly_characters')
        .insert({
            ...character,
            user_id: user.id,
        })
        .select()
        .single()

    if (error) {
        console.error('❌ Supabase error creating character:', error)
        throw error
    }

    console.log('✅ Character created successfully:', data)
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
        .from('yours_brightly_characters')
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
        .from('yours_brightly_characters')
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
    console.log('🏗️ createNewCharacter (Supabase) starting...')
    try {
        console.log('📝 Creating character with default values...')
        const character = await createCharacter({
            name: 'New Character',
            appearance: 'A mysterious figure with an intriguing presence.',
            traits: 'Curious, intelligent, and thoughtful.',
            emotions: 'Calm and collected, with hints of excitement.',
            context: 'A helpful companion ready for meaningful conversations.',
            is_public: false,
        })

        console.log('🔍 Character creation result:', character)

        if (!character) {
            console.error('❌ Character creation returned null')
            throw new Error('Failed to create character')
        }

        const result = { id: character.id }
        console.log('✨ Returning character ID:', result)
        return result
    } catch (error) {
        console.error('💥 Error in createNewCharacter:', error)
        throw error
    }
}

/**
 * Convert Supabase character to legacy format for compatibility
 */
export const toLegacyCharacter = (character: Character): LegacyCharacter => {
    return {
        id: character.id,
        name: character.name,
        avatar: character.avatar || '',
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
        avatar: legacy.avatar || null,
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
    let charactersSubscription: any = null

    // Check if user is already authenticated and get initial data
    const checkCurrentUser = async () => {
        const { data: { user } } = await supabaseClient.auth.getUser()
        if (user) {
            console.log('📊 subscribeToUserCharacters - found existing user:', user.id)
            // Get initial characters
            const characters = await getUserCharacters()
            console.log('📊 subscribeToUserCharacters - initial characters:', characters.length)
            callback(characters)

            // Set up real-time subscription for character changes
            charactersSubscription = supabaseClient
                .channel(`user-characters-changes-${user.id}`)
                .on(
                    'postgres_changes',
                    {
                        event: '*',
                        schema: 'public',
                        table: 'yours_brightly_characters',
                        filter: `user_id=eq.${user.id}`,
                    },
                    async () => {
                        // Refetch all characters when any change occurs
                        console.log('📊 subscribeToUserCharacters - character change detected')
                        const characters = await getUserCharacters()
                        callback(characters)
                    }
                )
                .subscribe()
        } else {
            console.log('📊 subscribeToUserCharacters - no user found')
            callback([])
        }
    }

    // Check immediately
    checkCurrentUser()

    // Set up auth state listener for future changes
    const authSubscription = supabaseClient.auth.onAuthStateChange(async (event, session) => {
        console.log('📊 subscribeToUserCharacters - auth state change:', event, !!session?.user)

        if (session?.user) {
            const userId = session.user.id

            // Get initial characters
            const characters = await getUserCharacters()
            callback(characters)

            // Clean up previous subscription if it exists
            if (charactersSubscription) {
                charactersSubscription.unsubscribe()
            }

            // Set up new real-time subscription for character changes
            charactersSubscription = supabaseClient
                .channel(`user-characters-changes-${userId}`)
                .on(
                    'postgres_changes',
                    {
                        event: '*',
                        schema: 'public',
                        table: 'yours_brightly_characters',
                        filter: `user_id=eq.${userId}`,
                    },
                    async () => {
                        // Refetch all characters when any change occurs
                        const characters = await getUserCharacters()
                        callback(characters)
                    }
                )
                .subscribe()
        } else {
            // Clean up subscription when user logs out
            if (charactersSubscription) {
                charactersSubscription.unsubscribe()
                charactersSubscription = null
            }
            callback([])
        }
    })

    // Return cleanup function
    return () => {
        authSubscription.data.subscription?.unsubscribe()
        if (charactersSubscription) {
            charactersSubscription.unsubscribe()
        }
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
                table: 'yours_brightly_characters',
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