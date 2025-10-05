import { createClient } from '@supabase/supabase-js'
import { supabaseUrl, supabaseAnonKey } from './constants'

// Create a single supabase client for interacting with the database
export const supabaseClient = createClient(supabaseUrl, supabaseAnonKey)

// Database types based on our PostgreSQL schema
export interface Database {
    public: {
        Tables: {
            // User profiles (standard Supabase profiles table)
            profiles: {
                Row: {
                    user_id: string
                    display_name: string | null
                    avatar_url: string | null
                    email: string | null
                    is_profile_public: boolean | null
                    default_character_id: string | null
                    created_at: string
                    updated_at: string
                }
                Insert: {
                    user_id: string
                    display_name?: string | null
                    avatar_url?: string | null
                    email?: string | null
                    is_profile_public?: boolean | null
                    default_character_id?: string | null
                    created_at?: string
                    updated_at?: string
                }
                Update: {
                    user_id?: string
                    display_name?: string | null
                    avatar_url?: string | null
                    email?: string | null
                    is_profile_public?: boolean | null
                    default_character_id?: string | null
                    created_at?: string
                    updated_at?: string
                }
            }
            // Multi-tenant character storage for Yours Brightly AI
            yours_brightly_characters: {
                Row: {
                    id: string
                    user_id: string
                    name: string
                    avatar: string | null
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
                    user_id?: string // defaults to auth.uid()
                    name: string
                    avatar?: string | null
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
                    avatar?: string | null
                    appearance?: string | null
                    traits?: string | null
                    emotions?: string | null
                    context?: string | null
                    is_public?: boolean
                    created_at?: string
                    updated_at?: string
                }
            }
            // Messages for character conversations
            yours_brightly_messages: {
                Row: {
                    id: string
                    character_id: string
                    sender_user_id: string
                    recipient_user_id: string
                    message_id: string
                    text: string
                    created_at: string
                    sender_name: string | null
                    sender_avatar: string | null
                    message_data: Record<string, any>
                }
                Insert: {
                    id?: string
                    character_id: string
                    sender_user_id?: string // defaults to auth.uid()
                    recipient_user_id: string
                    message_id: string
                    text: string
                    created_at?: string
                    sender_name?: string | null
                    sender_avatar?: string | null
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
                    sender_avatar?: string | null
                    message_data?: Record<string, any>
                }
            }
            // User app subscriptions (multi-tenant subscription management)
            user_app_subscriptions: {
                Row: {
                    id: string
                    user_id: string
                    app: string
                    plan: string
                    status: string
                    credits_balance: number
                    terms_accepted: boolean
                    terms_version: string | null
                    terms_accepted_at: string | null
                    stripe_subscription_id: string | null
                    stripe_customer_id: string | null
                    billing_cycle_start: string | null
                    billing_cycle_end: string | null
                    created_at: string
                    updated_at: string
                }
                Insert: {
                    id?: string
                    user_id: string
                    app: string
                    plan?: string
                    status?: string
                    credits_balance?: number
                    terms_accepted?: boolean
                    terms_version?: string | null
                    terms_accepted_at?: string | null
                    stripe_subscription_id?: string | null
                    stripe_customer_id?: string | null
                    billing_cycle_start?: string | null
                    billing_cycle_end?: string | null
                    created_at?: string
                    updated_at?: string
                }
                Update: {
                    id?: string
                    user_id?: string
                    app?: string
                    plan?: string
                    status?: string
                    credits_balance?: number
                    terms_accepted?: boolean
                    terms_version?: string | null
                    terms_accepted_at?: string | null
                    stripe_subscription_id?: string | null
                    stripe_customer_id?: string | null
                    billing_cycle_start?: string | null
                    billing_cycle_end?: string | null
                    created_at?: string
                    updated_at?: string
                }
            }
        }
        Views: {
            // react-native-gifted-chat compatible view
            yours_brightly_messages_gifted_chat: {
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
            // Check if user has access to an app
            user_has_app_access: {
                Args: {
                    app_name: string
                }
                Returns: boolean
            }
            // Get character count for a user
            get_user_character_count: {
                Args: {
                    p_user_id?: string
                }
                Returns: number
            }
            // Get message count for a character
            get_character_message_count: {
                Args: {
                    p_character_id: string
                }
                Returns: number
            }
        }
    }
}

// Type our supabase client
export type SupabaseClient = typeof supabaseClient