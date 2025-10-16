# SQLite Message Storage Migration

## Overview

This document describes the migration from Supabase cloud storage to local SQLite storage for chat messages in the Clanker app.

## Architecture Change

### Before (Supabase Cloud)

```
User Message → Supabase Database → Real-time Subscription → UI Update
AI Response  → Supabase Database → Real-time Subscription → UI Update
```

### After (Local SQLite)

```
User Message → Local SQLite → React Query Invalidation → UI Update
AI Response  → Local SQLite → React Query Polling (5s) → UI Update
```

## Key Benefits

1. **Local-First**: All messages stored on device for instant access and offline support
2. **No Network Dependency**: Chat works completely offline
3. **Better Performance**: No network latency for message loading
4. **Privacy**: Messages stay on the user's device
5. **Simplified Architecture**: No real-time subscription management needed

## Implementation Details

### Database Schema

**File**: `src/database/schema.ts`

SQLite table structure:
- `messages`: Main message storage
  - `id` (TEXT PRIMARY KEY): Unique message identifier
  - `character_id` (TEXT): Character the message belongs to
  - `sender_user_id` (TEXT): User who sent the message
  - `recipient_user_id` (TEXT): Who should receive the message (character ID or user ID)
  - `text` (TEXT): Message content
  - `created_at` (INTEGER): Unix timestamp
  - `message_data` (TEXT): JSON string of additional IMessage properties
  - `pending`, `sent`, `error`, `edited` (INTEGER): Status flags (0 or 1)

**Indexes** for performance:
- `idx_messages_character`: Fast lookup by character_id
- `idx_messages_conversation`: Fast conversation lookup
- `idx_messages_created_at`: Efficient sorting by date

### Database Layer

**File**: `src/database/index.ts`

Core database operations:
- `getDatabase()`: Initialize and return DB connection
- `initializeDatabase()`: Create tables and run migrations
- `runMigrations()`: Apply schema updates
- `clearAllData()`: Reset database (testing)
- `getDatabaseStats()`: Get usage statistics

**File**: `src/database/messageDatabase.ts`

Message CRUD operations:
- `getMessages()`: Fetch messages for a character conversation
- `sendMessage()`: Save user message to local DB
- `saveAIMessage()`: Save AI response to local DB
- `updateMessageStatus()`: Update pending/sent/error flags
- `updateMessageText()`: Edit message text
- `deleteMessage()`: Remove a message
- `deleteCharacterMessages()`: Clear all messages for a character
- `getMessageCount()`: Count messages in conversation
- `getLastMessage()`: Get most recent message (for previews)
- `searchMessages()`: Full-text search within messages
- `batchInsertMessages()`: Bulk insert (for data migration)

### Service Layer

**File**: `src/services/messageService.ts`

Simplified API that wraps database operations:
- Removed all Supabase calls
- Removed `supabaseClient.auth.getUser()` calls
- Uses `userId` directly from context
- Maps database operations to IMessage format

**File**: `src/services/aiChatService.ts`

Updated to use local storage:
- Changed `recipientUserId` parameter to `userId`
- Uses `saveAIMessage()` directly for AI responses
- Simplified error handling
- No need for Supabase RPC calls

### React Query Hooks

**File**: `src/hooks/useMessages.ts`

Major changes:
- **Removed**: Supabase real-time subscriptions
- **Added**: `refetchInterval: 5000` for polling AI responses
- **Updated**: Query function to use userId from auth context
- **Simplified**: No need for subscription cleanup

Key hooks:
- `useMessages()`: Query messages with automatic refetch
- `useSendMessage()`: Mutation with optimistic updates
- `useDeleteMessage()`: Delete with optimistic updates
- `useUpdateMessage()`: Edit with optimistic updates

**File**: `src/hooks/useAIChat.ts`

Parameter changes:
- `recipientUserId` → `userId`
- All query keys updated to use `userId`
- Mutation functions pass `userId` to services

## Breaking Changes

### API Changes

1. **Function Signatures**:
   ```typescript
   // Before
   sendMessage(characterId: string, recipientUserId: string, message: IMessage)
   getMessages(characterId: string, recipientUserId: string)
   
   // After
   sendMessage(characterId: string, userId: string, message: IMessage)
   getMessages(characterId: string, userId: string)
   ```

2. **Hook Parameters**:
   ```typescript
   // Before
   useAIChat({ characterId, recipientUserId, character })
   
   // After
   useAIChat({ characterId, userId, character })
   ```

3. **Real-time Updates**:
   - **Before**: Instant updates via Supabase real-time subscriptions
   - **After**: Polling every 5 seconds (configurable in `refetchInterval`)

### Removed Features

1. **Supabase Real-time Subscriptions**: No longer needed
2. **Supabase Auth Integration**: Messages use userId from local auth context
3. **RLS Policies**: Local storage doesn't need server-side access control
4. **Cloud Message Sync**: Messages are local-only (for now)

## Migration Strategy

### For New Users

✅ **No action needed** - Database creates automatically on first use

### For Existing Users

⚠️ **Important**: Existing Supabase messages will NOT be migrated automatically

**Option 1: Start Fresh** (Recommended for MVP)
- Users start with empty message history on local device
- Keep Supabase messages for reference/backup
- Gradually sunset Supabase message table

**Option 2: One-Time Migration** (Future enhancement)
Create a migration utility:
```typescript
// Future implementation
async function migrateSupabaseToSQLite(userId: string) {
  // 1. Fetch all messages from Supabase
  const supabaseMessages = await fetchAllSupabaseMessages(userId)
  
  // 2. Convert to LocalMessage format
  const localMessages = supabaseMessages.map(convertToLocalMessage)
  
  // 3. Batch insert into SQLite
  await batchInsertMessages(localMessages)
}
```

**Option 3: Hybrid Approach** (Complex)
- Keep Supabase for cross-device sync
- Use SQLite for local caching
- Requires sync logic and conflict resolution

## Testing Checklist

Before deploying:

- [ ] Test message sending (user → character)
- [ ] Test AI response generation
- [ ] Test message loading on app restart
- [ ] Test offline message sending
- [ ] Test message editing
- [ ] Test message deletion
- [ ] Test character deletion (clears messages)
- [ ] Test optimistic updates UI
- [ ] Test error handling and fallback messages
- [ ] Test message search functionality
- [ ] Test database migrations (schema updates)
- [ ] Test with multiple characters
- [ ] Test with large message histories (1000+ messages)

## Performance Considerations

### Query Optimization

1. **Indexes**: All critical queries use indexes
   - Character ID: Fast character conversation lookup
   - Created At: Efficient sorting and pagination
   - Conversation: Quick user-character message filtering

2. **Pagination**: Default 50 messages per load
   ```typescript
   getMessages(characterId, userId, limit = 50, offset = 0)
   ```

3. **Polling Interval**: Balance freshness vs battery life
   - Current: 5 seconds (adjust based on usage)
   - Consider increasing to 10-15 seconds for battery optimization

### Storage Management

- **Message Limit**: Consider implementing max messages per character (e.g., 1000)
- **Auto-cleanup**: Add utility to delete old messages
- **Storage Monitoring**: Use `getDatabaseStats()` to track database size

## Rollback Plan

If SQLite migration has issues:

1. **Keep Supabase Code**: Don't delete Supabase migration files yet
2. **Feature Flag**: Add config to switch between SQLite/Supabase
3. **Revert**: Restore `messageService.ts` and `useMessages.ts` from git history
4. **Redeploy**: Push previous working version

## Future Enhancements

### Phase 2: Cross-Device Sync

Add optional cloud sync:
- Background sync to Supabase (when online)
- Conflict resolution (last-write-wins or user prompt)
- Sync status indicator in UI

### Phase 3: Export/Import

Allow users to backup/restore messages:
- Export to JSON file
- Import from JSON file
- Share conversations

### Phase 4: Advanced Features

- Message reactions (emoji)
- Message threading
- Voice message storage
- Image attachments in messages
- Message encryption at rest

## File Changes Summary

### New Files
- ✅ `src/database/schema.ts` - SQLite schema definition
- ✅ `src/database/index.ts` - Database connection and initialization
- ✅ `src/database/messageDatabase.ts` - Message CRUD operations

### Modified Files
- ✅ `src/services/messageService.ts` - Replaced Supabase with SQLite
- ✅ `src/services/aiChatService.ts` - Updated to use saveAIMessage()
- ✅ `src/hooks/useMessages.ts` - Removed real-time subscriptions
- ✅ `src/hooks/useAIChat.ts` - Updated parameter names

### Files to Update (Next Steps)
- ⏳ Any component using `recipientUserId` → change to `userId`
- ⏳ Any component displaying "last message" → use `getLastMessage()`
- ⏳ Settings screen → add database cleanup options
- ⏳ Character deletion → ensure messages are cleaned up

## Support and Troubleshooting

### Common Issues

**Q: Messages not appearing after sending**
- Check: React Query refetch interval is active
- Check: Database initialization succeeded (check console logs)
- Check: userId is correctly passed to hooks

**Q: Database errors on startup**
- Check: expo-sqlite is installed (`npm list expo-sqlite`)
- Check: Database schema migration ran successfully
- Try: Clear app data and restart

**Q: Poor performance with many messages**
- Check: Indexes are created (`PRAGMA index_list('messages')`)
- Consider: Implementing pagination for large conversations
- Consider: Archiving old messages

**Q: Messages lost after app reinstall**
- Expected: SQLite is local storage, cleared on uninstall
- Future: Implement cloud sync for persistence

### Debug Commands

```typescript
// Get database stats
import { getDatabaseStats } from '~/database'
const stats = await getDatabaseStats()
console.log('Messages:', stats.messageCount)

// Clear all data (testing only)
import { clearAllData } from '~/database'
await clearAllData()

// Check schema version
import { getDatabase } from '~/database'
const db = await getDatabase()
const version = await db.getFirstAsync('SELECT version FROM schema_version')
console.log('Schema version:', version)
```

## Next Steps

1. **Test thoroughly** on iOS, Android, and Web
2. **Update component usage** if any still use `recipientUserId`
3. **Add user-facing features**:
   - Message count badge on character cards
   - "Clear conversation" button in settings
   - Storage usage indicator
4. **Monitor performance** with real-world message volumes
5. **Plan data migration** for existing users (if needed)

## Questions?

Contact the development team or open an issue in the repository.
