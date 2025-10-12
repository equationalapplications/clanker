/**
 * TypeScript types for Yours Brightly AI database tables
 * Generated from: 20251004000006_yours_brightly_characters_table.sql
 */

// ============================================================================
// Core Character Type
// ============================================================================

export interface YoursbrightlyCharacter {
  id: string // UUID
  user_id: string // UUID - references auth.users(id)

  // Character data
  name: string // max 30 characters
  avatar: string | null // URL to character's avatar image
  appearance: string | null // max 144 characters
  traits: string | null // max 144 characters
  emotions: string | null // max 144 characters
  context: string | null // Conversation memory/context

  // Visibility
  is_public: boolean

  // Metadata
  created_at: string // ISO timestamp
  updated_at: string // ISO timestamp
}

// Input type for creating a new character
export interface CreateCharacterInput {
  name: string
  avatar?: string | null
  appearance?: string | null
  traits?: string | null
  emotions?: string | null
  context?: string | null
  is_public?: boolean
}

// Input type for updating a character
export interface UpdateCharacterInput {
  name?: string
  avatar?: string | null
  appearance?: string | null
  traits?: string | null
  emotions?: string | null
  context?: string | null
  is_public?: boolean
}

// ============================================================================
// Message Types (for chat functionality)
// ============================================================================

export interface YoursbrightlyMessage {
  id: string // UUID
  character_id: string // UUID - references yours_brightly_characters(id)
  sender_user_id: string // UUID - references auth.users(id)
  recipient_user_id: string // UUID - references auth.users(id)

  // Message data (react-native-gifted-chat compatible)
  message_id: string // UUID string for IMessage._id
  text: string
  created_at: string // ISO timestamp

  // Denormalized user info for performance
  sender_name: string | null
  sender_avatar: string | null

  // Additional message data stored as JSONB
  message_data: Record<string, any>
}

// Input type for creating a new message
export interface CreateMessageInput {
  character_id: string
  recipient_user_id: string
  message_id: string // UUID string
  text: string
  message_data?: Record<string, any>
}

// ============================================================================
// react-native-gifted-chat Compatibility Types
// ============================================================================

// Type for the gifted-chat view format
export interface YoursbrightlyMessageGiftedChat {
  id: string // Internal DB id
  character_id: string
  sender_user_id: string
  recipient_user_id: string
  _id: string // message_id for gifted-chat
  text: string
  createdAt: string // ISO timestamp
  user: {
    _id: string // sender_user_id
    name: string | null
    avatar: string | null
  }
  message_data: Record<string, any>
}

// Standard react-native-gifted-chat IMessage type for reference
export interface IMessage {
  _id: string | number
  text: string
  createdAt: Date | number | string
  user: {
    _id: string | number
    name?: string
    avatar?: string | (() => any)
  }
  image?: string
  video?: string
  audio?: string
  system?: boolean
  sent?: boolean
  received?: boolean
  pending?: boolean
  quickReplies?: any
  [key: string]: any
}

// ============================================================================
// Database Function Return Types
// ============================================================================

export interface CharacterCountResult {
  count: number
}

export interface MessageCountResult {
  count: number
}

// ============================================================================
// Supabase Query Result Types
// ============================================================================

// For use with Supabase queries
export type CharacterRow = YoursbrightlyCharacter
export type MessageRow = YoursbrightlyMessage
export type MessageGiftedChatRow = YoursbrightlyMessageGiftedChat

// ============================================================================
// API Response Types
// ============================================================================

export interface CharacterResponse {
  success: boolean
  data?: YoursbrightlyCharacter
  error?: string
}

export interface CharactersListResponse {
  success: boolean
  data?: YoursbrightlyCharacter[]
  error?: string
}

export interface MessageResponse {
  success: boolean
  data?: YoursbrightlyMessage
  error?: string
}

export interface MessagesListResponse {
  success: boolean
  data?: YoursbrightlyMessageGiftedChat[]
  error?: string
}

// ============================================================================
// Helper Types for Components
// ============================================================================

// Simplified character type for list views
export interface CharacterListItem {
  id: string
  name: string
  avatar: string | null
  is_public: boolean
  created_at: string
}

// Character with message count
export interface CharacterWithMessageCount extends YoursbrightlyCharacter {
  message_count?: number
}

// ============================================================================
// Type Guards
// ============================================================================

export function isCharacter(obj: any): obj is YoursbrightlyCharacter {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    typeof obj.id === 'string' &&
    typeof obj.user_id === 'string' &&
    typeof obj.name === 'string' &&
    typeof obj.is_public === 'boolean'
  )
}

export function isMessage(obj: any): obj is YoursbrightlyMessage {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    typeof obj.id === 'string' &&
    typeof obj.character_id === 'string' &&
    typeof obj.message_id === 'string' &&
    typeof obj.text === 'string'
  )
}

// ============================================================================
// Validation Constraints (matches database constraints)
// ============================================================================

export const CONSTRAINTS = {
  CHARACTER_NAME_MAX_LENGTH: 30,
  CHARACTER_APPEARANCE_MAX_LENGTH: 144,
  CHARACTER_TRAITS_MAX_LENGTH: 144,
  CHARACTER_EMOTIONS_MAX_LENGTH: 144,
} as const

// ============================================================================
// Utility Types
// ============================================================================

// Make all fields optional except id (for partial updates)
export type PartialCharacter = Partial<YoursbrightlyCharacter> & { id: string }

// Make all fields required (for validation)
export type RequiredCharacter = Required<YoursbrightlyCharacter>

// Pick specific fields for different use cases
export type CharacterSummary = Pick<YoursbrightlyCharacter, 'id' | 'name' | 'avatar' | 'is_public'>
export type CharacterDetails = Omit<YoursbrightlyCharacter, 'context'> // Exclude large context field
