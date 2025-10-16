# Character Storage SQLite Migration

## Overview

This document describes the migration from Supabase cloud storage to local SQLite storage for characters in the Clanker app, while preserving Supabase integration for future "save character" feature.

## Architecture

### Storage Strategy

**Primary Storage**: Local SQLite database
- All characters stored on device
- Instant access, no network required
- Perfect for offline-first experience

**Cloud Storage** (Future): Supabase (preserved in `cloudCharacterService.ts`)
- Will be used for "save character" feature
- Enable character sharing between users
- Cross-device sync
- Public character library

### Data Flow

```
User Action → Local SQLite → UI Update (instant)
               ↓ (future)
           Cloud Sync (optional)
               ↓
           Supabase (for sharing/backup)
```

## Implementation Details

### Database Schema

**File**: `src/database/schema.ts`

New `characters` table:
```sql
CREATE TABLE characters (
  id TEXT PRIMARY KEY,           -- Local character ID
  user_id TEXT NOT NULL,         -- Owner user ID
  name TEXT NOT NULL,
  avatar TEXT,
  appearance TEXT,
  traits TEXT,
  emotions TEXT,
  context TEXT,
  is_public INTEGER DEFAULT 0,   -- Boolean flag
  created_at INTEGER NOT NULL,   -- Unix timestamp
  updated_at INTEGER NOT NULL,   -- Unix timestamp
  synced_to_cloud INTEGER DEFAULT 0,  -- Sync status flag
  cloud_id TEXT                  -- Supabase ID (when synced)
);
```

**Key Fields for Cloud Sync**:
- `synced_to_cloud`: Indicates if character is backed up to Supabase
- `cloud_id`: References the Supabase `yours_brightly_characters.id`

**Indexes**:
- `idx_characters_user`: Fast lookup by user_id
- `idx_characters_created_at`: Efficient sorting
- `idx_characters_cloud_id`: Quick cloud sync lookups

### Database Layer

**File**: `src/database/characterDatabase.ts`

Core operations:
- `getUserCharacters(userId)`: Get all user's characters
- `getCharacter(characterId, userId)`: Get specific character
- `createCharacter(userId, data)`: Create new character
- `updateCharacter(characterId, userId, updates)`: Update character
- `deleteCharacter(characterId, userId)`: Delete character
- `getCharacterCount(userId)`: Count user's characters
- `searchCharacters(userId, searchText)`: Search by name
- `markCharacterSynced(localId, cloudId)`: Mark as synced to cloud
- `getUnsyncedCharacters(userId)`: Get characters needing sync
- `batchInsertCharacters(characters)`: Bulk import (for cloud sync)

### Service Layer

**File**: `src/services/localCharacterService.ts` (NEW)
- Local SQLite operations
- Wraps database layer with error handling
- Returns data in app format

**File**: `src/services/cloudCharacterService.ts` (RENAMED from characterService.ts)
- Preserved Supabase integration
- Will be used for cloud sync feature
- Keeps all RLS policies and real-time subscriptions

**File**: `src/services/characterService.ts` (NEW - main interface)
- Delegates to `localCharacterService` for primary operations
- Exports placeholder functions for future cloud sync:
  - `saveCharacterToCloud()` - Not yet implemented
  - `loadCharacterFromCloud()` - Not yet implemented
  - `getPublicCharacters()` - Not yet implemented
  - `syncCharacterFromCloud()` - Not yet implemented

### React Query Hooks

**File**: `src/hooks/useCharacters.ts`

Updated hooks:
- **Removed**: Supabase real-time subscriptions
- **Updated**: All mutations to pass `userId` parameter
- **Simplified**: No subscription cleanup needed

Key changes:
```typescript
// Before
getUserCharacters() // Used Supabase auth internally

// After
getUserCharacters(userId) // Explicit user ID parameter
```

## Breaking Changes

### API Changes

All character service functions now require `userId` parameter:

```typescript
// Before (Supabase)
createCharacter(character: CharacterInsert)
updateCharacter(id: string, updates: CharacterUpdate)
deleteCharacter(id: string)
getCharacter(id: string)

// After (SQLite)
createCharacter(userId: string, character: CharacterInsert)
updateCharacter(id: string, userId: string, updates: CharacterUpdate)
deleteCharacter(id: string, userId: string)
getCharacter(id: string, userId: string)
```

### Hook Updates

Hooks now get userId from auth context internally:
```typescript
// Hooks handle userId internally - no API changes
const { characters } = useCharacters()
const { character } = useCharacter(characterId)
const createMutation = useCreateCharacter()
```

### Data Format Changes

**Character Type** now includes sync fields:
```typescript
interface Character {
  // ... existing fields
  synced_to_cloud?: boolean    // NEW
  cloud_id?: string | null     // NEW
}
```

## Migration Strategy

### For New Users

✅ **No action needed** - Characters create in local database automatically

### For Existing Users

⚠️ **Important**: Existing Supabase characters will NOT migrate automatically

**Recommended Approach** (Phased Migration):

**Phase 1: New Characters Local-Only** (Current)
- All new characters created in local SQLite
- Existing Supabase characters remain in cloud
- Dual-read: Check SQLite first, fallback to Supabase (future enhancement)

**Phase 2: Implement Cloud Sync** (Future)
```typescript
// Example implementation
async function syncUserCharacters(userId: string) {
  // 1. Get all Supabase characters
  const cloudChars = await cloudCharacterService.getUserCharacters()
  
  // 2. Import to local SQLite
  for (const char of cloudChars) {
    await localCharacterService.createCharacter(userId, {
      name: char.name,
      avatar: char.avatar,
      // ... other fields
    })
    // Mark as synced with cloud_id
    await markCharacterSynced(localChar.id, char.id)
  }
}
```

**Phase 3: Enable Two-Way Sync** (Future)
- Local changes push to cloud
- Cloud changes pull to local
- Conflict resolution strategy

## Cloud Sync Feature (Future)

### "Save Character" Flow

```typescript
// User clicks "Save to Cloud"
const result = await saveCharacterToCloud(characterId, userId)

// Behind the scenes:
// 1. Get local character
const local = await getCharacter(characterId, userId)

// 2. Create in Supabase
const cloud = await cloudCharacterService.createCharacter({
  name: local.name,
  // ... map all fields
})

// 3. Mark as synced
await markCharacterSynced(characterId, cloud.id)

// 4. Show success message
toast.success('Character saved to cloud!')
```

### "Load Character" Flow

```typescript
// User browses public characters
const publicChars = await getPublicCharacters()

// User clicks "Add to My Characters"
await loadCharacterFromCloud(cloudId, userId)

// Behind the scenes:
// 1. Fetch from Supabase
const cloud = await cloudCharacterService.getCharacter(cloudId)

// 2. Create local copy
const local = await createCharacter(userId, {
  name: cloud.name,
  // ... map fields
})

// 3. Link to cloud
await markCharacterSynced(local.id, cloudId)
```

### Sync Status UI

Add indicators to show sync status:
```typescript
function CharacterCard({ character }: { character: Character }) {
  return (
    <View>
      <Text>{character.name}</Text>
      {character.synced_to_cloud && (
        <CloudIcon tooltip="Backed up to cloud" />
      )}
      {!character.synced_to_cloud && (
        <Button onPress={() => saveCharacterToCloud(character.id, userId)}>
          Save to Cloud
        </Button>
      )}
    </View>
  )
}
```

## File Changes Summary

### New Files
- ✅ `src/database/characterDatabase.ts` - SQLite character operations
- ✅ `src/services/localCharacterService.ts` - Local character service
- ✅ `src/services/characterService.ts` - Main interface (delegates to local)

### Renamed Files
- ✅ `src/services/characterService.ts` → `src/services/cloudCharacterService.ts`

### Modified Files
- ✅ `src/database/schema.ts` - Added characters table
- ✅ `src/hooks/useCharacters.ts` - Updated to use local storage, removed Supabase subscriptions

### Preserved Files
- ✅ `src/services/cloudCharacterService.ts` - Supabase integration for future use

## Testing Checklist

Before deploying:

- [ ] Test character creation
- [ ] Test character editing
- [ ] Test character deletion (verify messages also deleted)
- [ ] Test character list loading
- [ ] Test character detail loading
- [ ] Test app restart (characters persist)
- [ ] Test offline character management
- [ ] Test with multiple users (no cross-user access)
- [ ] Test character search
- [ ] Test optimistic updates
- [ ] Test error handling
- [ ] Test with large character counts (100+ characters)

## Performance Considerations

### Query Optimization

1. **Indexes**: All queries use appropriate indexes
2. **Cache First**: React Query caches reduce database hits
3. **Lazy Loading**: Characters load on demand

### Storage Management

- **Character Limit**: Consider max characters per user (e.g., 100)
- **Auto-cleanup**: Option to delete unused characters
- **Storage Monitoring**: Track database size

## Rollback Plan

If issues arise:

1. **Revert to Supabase**:
   ```bash
   mv src/services/cloudCharacterService.ts src/services/characterService.ts
   git checkout src/hooks/useCharacters.ts
   ```

2. **Hybrid Mode** (if needed):
   - Keep both implementations
   - Use feature flag to switch
   - Gradually migrate users

## Next Steps

1. **Test Migration**: Thorough testing on all platforms
2. **Monitor Performance**: Track database operations
3. **Plan Cloud Sync**: Design sync strategy and UI
4. **Implement Dual-Read**: Support reading from both storages during transition
5. **Build Sync UI**: Add "Save to Cloud" buttons and sync status indicators

## Future Enhancements

### Phase 2: Character Sharing
- Public character library
- Import characters from other users
- Character ratings and reviews

### Phase 3: Advanced Sync
- Real-time sync across devices
- Conflict resolution
- Selective sync (choose which characters to back up)

### Phase 4: Character Templates
- Pre-made character templates
- Character categories
- Character versioning

## Questions?

Contact the development team or open an issue in the repository.
