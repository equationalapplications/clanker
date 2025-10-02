import { createClient } from '@supabase/supabase-js'
import { supabaseUrl, supabaseAnonKey } from './constants'

// Create a single supabase client for interacting with the database
export const supabaseClient = createClient(supabaseUrl, supabaseAnonKey)

// Database types based on our PostgreSQL schema
export interface Database {
    public: {
        Tables: {
            yours_brightly: {
                Row: {
                    id: string
                    user_id: string
                    display_name: string | null
                    email: string | null
                    avatar_url: string | null
                    is_profile_public: boolean
                    credits: number
                    default_character_id: string | null
                    preferences: Record<string, any>
                    profile_data: Record<string, any>
                    created_at: string
                    updated_at: string
                }
                Insert: {
                    id?: string
                    user_id: string
                    display_name?: string | null
                    email?: string | null
                    avatar_url?: string | null
                    is_profile_public?: boolean
                    credits?: number
                    default_character_id?: string | null
                    preferences?: Record<string, any>
                    profile_data?: Record<string, any>
                    created_at?: string
                    updated_at?: string
                }
                Update: {
                    id?: string
                    user_id?: string
                    display_name?: string | null
                    email?: string | null
                    avatar_url?: string | null
                    is_profile_public?: boolean
                    credits?: number
                    default_character_id?: string | null
                    preferences?: Record<string, any>
                    profile_data?: Record<string, any>
                    created_at?: string
                    updated_at?: string
                }
            }
            characters: {
                Row: {
                    id: string
                    user_id: string
                    name: string
                    avatar_url: string | null
                    appearance: string | null
                    traits: string | null
                    emotions: string | null
                    context: string | null
                    is_public: boolean
                    created_at: string
                    updated_at: string
                }
                Insert: {
                    id?: string
                    user_id: string
                    name: string
                    avatar_url?: string | null
                    appearance?: string | null
                    traits?: string | null
                    emotions?: string | null
                    context?: string | null
                    is_public?: boolean
                    created_at?: string
                    updated_at?: string
                }
                Update: {
                    id?: string
                    user_id?: string
                    name?: string
                    avatar_url?: string | null
                    appearance?: string | null
                    traits?: string | null
                    emotions?: string | null
                    context?: string | null
                    is_public?: boolean
                    created_at?: string
                    updated_at?: string
                }
            }
            messages: {
                Row: {
                    id: string
                    character_id: string
                    sender_user_id: string
                    recipient_user_id: string
                    message_id: string
                    text: string
                    created_at: string
                    sender_name: string | null
                    sender_avatar_url: string | null
                    message_data: Record<string, any>
                }
                Insert: {
                    id?: string
                    character_id: string
                    sender_user_id: string
                    recipient_user_id: string
                    message_id: string
                    text: string
                    created_at?: string
                    sender_name?: string | null
                    sender_avatar_url?: string | null
                    message_data?: Record<string, any>
                }
                Update: {
                    id?: string
                    character_id?: string
                    sender_user_id?: string
                    recipient_user_id?: string
                    message_id?: string
                    text?: string
                    created_at?: string
                    sender_name?: string | null
                    sender_avatar_url?: string | null
                    message_data?: Record<string, any>
                }
            }
            user_app_permissions: {
                Row: {
                    id: string
                    user_id: string
                    app_name: string
                    granted_at: string
                    terms_accepted_at: string | null
                    terms_version: string | null
                    created_at: string
                    updated_at: string
                }
                Insert: {
                    id?: string
                    user_id: string
                    app_name: string
                    granted_at?: string
                    terms_accepted_at?: string | null
                    terms_version?: string | null
                    created_at?: string
                    updated_at?: string
                }
                Update: {
                    id?: string
                    user_id?: string
                    app_name?: string
                    granted_at?: string
                    terms_accepted_at?: string | null
                    terms_version?: string | null
                    created_at?: string
                    updated_at?: string
                }
            }
        }
        Views: {
            messages_gifted_chat: {
                Row: {
                    id: string
                    character_id: string
                    sender_user_id: string
                    recipient_user_id: string
                    _id: string
                    text: string
                    createdAt: string
                    user: {
                        _id: string
                        name: string | null
                        avatar: string | null
                    }
                    message_data: Record<string, any>
                }
            }
        }
        Functions: {
            insert_message: {
                Args: {
                    p_character_id: string
                    p_recipient_user_id: string
                    p_message_id: string
                    p_text: string
                    p_message_data?: Record<string, any>
                }
                Returns: string
            }
            grant_app_access: {
                Args: {
                    p_user_id: string
                    p_app_name: string
                    p_terms_version?: string
                }
                Returns: boolean
            }
            get_user_display_info: {
                Args: {
                    p_user_id: string
                }
                Returns: Array<{
                    display_name: string
                    avatar_url: string | null
                }>
            }
        }
    }
}

// Type our supabase client
export type SupabaseClient = typeof supabaseClient