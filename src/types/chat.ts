import type { GroundingMetadata } from '@google/genai'

export interface ChatUser {
  _id: string
  name?: string
  avatar?: string
}

export interface Message {
  _id: string
  text: string
  createdAt: Date
  user: ChatUser
  // DB columns surfaced on the row
  pending?: boolean
  sent?: boolean
  error?: boolean
  edited?: boolean
  // Carried in the message_data JSON blob — arrived as untyped extras
  imageId?: string
  groundingMetadata?: GroundingMetadata
}

// Helper for the one producer that also needs `character_id` on the row.
export type MessageWithCharacter = Message & { character_id: string }
