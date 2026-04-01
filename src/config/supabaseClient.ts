import { createClient } from '@supabase/supabase-js'
import { Platform } from 'react-native'
import Storage from 'expo-sqlite/kv-store'

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!

// supabase-js's internal fetchWithAuth always passes a Headers *instance* to fetch,
// but React Native's native fetch bridge (OkHttp on Android) does not reliably
// serialise Headers objects — it expects a plain Record<string, string>.
// Checking `instanceof Headers` is unreliable in Hermes because the Headers constructor
// captured at module-init time by supabase-js may differ from the global reference here.
// Duck-type instead: anything with a .forEach() method is treated as a Headers instance.
function plainHeadersFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const h = init?.headers
  if (h != null && typeof (h as any).forEach === 'function') {
    const plain: Record<string, string> = {}
      ; (h as any).forEach((value: string, key: string) => {
        plain[key] = value
      })
    return fetch(input, { ...init, headers: plain })
  }
  return fetch(input, init)
}

// Create a single supabase client for interacting with the database
// autoRefreshToken is disabled to prevent Supabase's automatic background refresh timer.
// Our sessions use real Supabase refresh tokens (from exchangeToken's magiclink→verify flow),
// so supabaseClient.auth.refreshSession() works and is called manually after purchases
// to pick up updated JWT claims (e.g. plans). Scheduled refresh is handled by useAuth.
export const supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: Platform.OS === 'web' ? localStorage : Storage,
    autoRefreshToken: false, // Manual refresh only — see useAuth and post-purchase flows
    persistSession: true,
    detectSessionInUrl: false,
  },
  global: { fetch: plainHeadersFetch },
})

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
      // Multi-tenant character storage for Clanker
      clanker_characters: {
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
      clanker_messages: {
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
          app_name: string
          plan_tier: string
          plan_status: string
          current_credits: number
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
          app_name: string
          plan_tier?: string
          plan_status?: string
          current_credits?: number
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
          app_name?: string
          plan_tier?: string
          plan_status?: string
          current_credits?: number
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
      clanker_messages_gifted_chat: {
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
      // User app subscriptions (multi-tenant subscription/credit system)
      user_app_subscriptions: {
        Row: {
          id: string
          user_id: string
          app_name: string
          plan_tier: string
          plan_status: string
          plan_start_at: string | null
          plan_renewal_at: string | null
          current_credits: number
          billing_provider: string | null
          billing_provider_id: string | null
          billing_metadata: Record<string, any>
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          app_name: string
          plan_tier?: string
          plan_status?: string
          plan_start_at?: string | null
          plan_renewal_at?: string | null
          current_credits?: number
          billing_provider?: string | null
          billing_provider_id?: string | null
          billing_metadata?: Record<string, any>
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          app_name?: string
          plan_tier?: string
          plan_status?: string
          plan_start_at?: string | null
          plan_renewal_at?: string | null
          current_credits?: number
          billing_provider?: string | null
          billing_provider_id?: string | null
          billing_metadata?: Record<string, any>
          created_at?: string
          updated_at?: string
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
