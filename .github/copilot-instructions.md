# Copilot Instructions - Clanker

AI chatbot Expo app with multi-tenant Firebase + Supabase architecture. Users create custom characters and chat with them using Vertex AI, with subscription-based access control.

## 📖 READ THE README FIRST

**Before starting any development work, always read the `README.md` file.** The README contains an index of all documentation with links to detailed guides in the `/docs` folder. When working on a specific feature or system:

1. Check the README for relevant documentation links
2. Read the linked documentation file(s) for implementation details
3. Review related files mentioned in the documentation
4. Only then proceed with development

**Why**: The README is the source of truth for finding documentation. Reading the appropriate docs first prevents mistakes, ensures you follow established patterns, and saves time by providing context and examples.

## ⚠️ CRITICAL REFACTORING RULES

**NEVER delete functional code during refactoring.** Follow these rules strictly:

1. **DO NOT delete files that are part of the app** - Even if temporarily unused during a refactor, functional files must be preserved with a `// TODO: Re-integrate this file after [refactor description]` comment at the top.

2. **DO NOT delete imports or function calls** - If temporarily not using an import or function during testing/refactoring, comment it out with `// TODO: Re-enable after [reason]` instead of deleting it.

3. **DO NOT create example or placeholder files** - Only create production-ready code. No `ExampleComponent.tsx` or `PlaceholderScreen.tsx` files that could be confused with real functionality.

4. **DO NOT replace working screens with TODO screens** - If a screen exists with functionality (edit, chat, etc.), preserve it. Don't replace it with a skeleton that says "TODO: Implement this".

5. **Mark deprecated code clearly** - If code is truly being replaced, add a comment: `// DEPRECATED: Use NewComponent instead. Will be removed in [version/date]`

6. **Verify before deletion** - Before suggesting file/code deletion, explicitly confirm with the user that it's not functional code that's temporarily disconnected during refactoring.

7. **DO NOT create temporary or sample files without asking** - Never create temporary utility files, sample data files, test SQL files, or any other temporary files without explicit user permission. These clutter the codebase. If you need to show an example, use a code block in your response instead.

**Why**: Deleting functional code during refactoring causes lost work, broken features, and confusion. Commenting preserves code that can be quickly restored or referenced. Temporary files clutter the repository and create maintenance burden.

## Architecture Overview

**Expo Router App**: File-based routing with React Navigation (Drawer + Bottom Tabs + Stacks). Built with Expo SDK 54, React Native 0.81, TypeScript.

**Multi-Tenant Auth**: Firebase Auth → Cloud Function (`exchangeToken`) → Supabase JWT with subscription claims. All data access controlled via RLS policies that validate `plans` array in JWT.

**AI Chat**: Users create characters (appearance, traits, emotions, context) and have conversations powered by Vertex AI. Messages stored in Supabase with real-time sync, rendered with `react-native-gifted-chat`.

**Subscription Model**: Free tier (50 credits), paid tiers (monthly_20, monthly_50, unlimited). Credits required for chat messages and image generation. Access enforcement via JWT claims + RLS policies.

## Project Structure

```
app/                         # Expo Router file-based routing
  _layout.tsx                # Root: Auth protection with Stack.Protected
  index.tsx                  # Landing: Auth-based redirect
  sign-in.tsx                # Public: Firebase Auth UI
  accept-terms.tsx           # Modal: Terms acceptance (optimistic UI)
  subscribe.tsx              # Modal: Subscription/credit purchase
  (app)/                     # Protected: Requires authentication
    _layout.tsx              # Drawer navigator + terms check
    (tabs)/                  # Bottom tabs for main features
      chats.tsx              # Chats list (TODO)
      characters/            # Character management stack
        _layout.tsx          # Stack navigator
        index.tsx            # Character list + creation
        [id].tsx             # Character details + chat UI
src/
  auth/                      # Firebase auth helpers
  services/
    aiChatService.ts         # Orchestrates user message → AI response
    vertexAIService.ts       # Vertex AI API calls
    characterService.ts      # Character CRUD operations
    messageService.ts        # Message persistence in Supabase
    imageStorageService.ts   # Avatar/image upload to Supabase Storage
  hooks/
    useAIChat.ts             # Chat logic with AI response generation
    useCharacter.ts          # Single character fetch + realtime updates
    useCharacterList.ts      # All user characters with React Query
    useChatMessages.ts       # Message history with realtime subscription
    useSubscriptionStatus.tsx # JWT claims parsing for subscription state
    useUserCredits.ts        # Credit balance from JWT + DB
  contexts/                  # Auth and app-wide state
  types/                     # TypeScript types for characters, messages
docs/                        # Detailed implementation docs
```

## Key Developer Workflows

### Run Development Server

```bash
npm start                    # Start with dev client
npm run android             # Run on Android device
npm run ios                 # Run on iOS device
npm run web                 # Run in browser
npx expo start --clear      # Clear cache if routing breaks
```

### Character Chat Flow

1. User creates character with personality traits (`characterService.createCharacter`)
2. User navigates to character detail screen (`/characters/[id]`)
3. Screen loads character + message history (`useCharacter`, `useChatMessages`)
4. User types message → sent to Supabase (`messageService.sendMessage`)
5. AI service generates response with character context (`vertexAIService.generateChatResponse`)
6. Response saved to Supabase → appears in chat via realtime subscription

### Credit Usage Pattern

```typescript
// Check credits before expensive operation
const { credits } = useUserCredits('yours-brightly');
if (credits < 5) {
  router.push('/subscribe'); // Show subscription modal
  return;
}

// Perform operation (credits deducted server-side via DB function)
await generateImage(...);
```

### Subscription Check Pattern

All protected routes check subscription via JWT claims:

```typescript
const { hasAccess, needsTerms } = useSubscriptionStatus('yours-brightly')

if (needsTerms) {
  router.replace('/accept-terms') // Optimistic UI - proceed immediately after click
}

if (!hasAccess) {
  router.replace('/subscribe') // No active subscription
}
```

## Critical Patterns

### Navigation Architecture (Two-Stage Auth)

**Stage 1 - Authentication** (`app/_layout.tsx`):

```tsx
<Stack.Protected guard={isLoggedIn}>
  <Stack.Screen name="(app)" /> {/* All app content */}
</Stack.Protected>
```

- Public routes: `sign-in`, `privacy`, `terms`
- Protected routes: `(app)`, `subscribe`, `accept-terms`
- Root `index.tsx` provides immediate redirect based on auth state

**Stage 2 - Terms Acceptance** (`app/(app)/_layout.tsx`):

```tsx
const { needsTerms } = useSubscriptionStatus('yours-brightly')
useEffect(() => {
  if (needsTerms) router.replace('/accept-terms')
}, [needsTerms])
```

- Only checked AFTER authentication
- Optimistic UI: User clicks accept → proceeds immediately, DB writes async
- Server validates via RLS policies on actual data access

**Why Two Stages?** Auth happens first (identity), terms checked second (compliance). Separates concerns and enables optimistic UX.

### GiftedChat Integration

Messages use `yours_brightly_messages_gifted_chat` view (pre-formatted):

```typescript
const { data: messages } = useChatMessages(characterId);

<GiftedChat
  messages={messages} // Already in GiftedChat format from view
  user={{ _id: currentUserId }}
  onSend={(msgs) => handleSend(msgs[0])}
/>
```

View maps `message_id` → `_id`, `created_at` → `createdAt`, includes user object.

### RLS Policy Pattern (Subscription Gating)

All `yours_brightly_*` tables require app access:

```sql
CREATE POLICY "users_with_access" ON yours_brightly_characters
FOR ALL USING (
  auth.uid() = user_id
  AND user_has_app_access('yours-brightly') -- JWT claim check
);
```

Helper functions read from JWT `plans` array (no DB queries):

- `user_has_app_access('yours-brightly')` - Any active subscription
- `user_has_tier_access('yours-brightly', 'monthly_20')` - Tier hierarchy check
- `user_has_current_terms('yours-brightly', '1.0')` - Terms version validation

### AI Context Building

Character personality shapes AI responses:

```typescript
const chatContext: ChatContext = {
  characterName: character.name,
  characterPersonality: character.context || character.appearance,
  characterTraits: `${character.traits} ${character.emotions}`.trim(),
  conversationHistory: recentMessages.slice(-10).map((msg) => ({
    role: msg.user._id === userId ? 'user' : 'assistant',
    content: msg.text,
  })),
}

const response = await generateChatResponse(userMessage, chatContext)
```

Context field can grow large - monitor and prune as needed.

### Realtime Message Sync

Messages update via Supabase realtime subscription:

```typescript
useEffect(() => {
  const channel = supabase
    .channel(`character:${characterId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'yours_brightly_messages' },
      (payload) => queryClient.invalidateQueries(['messages', characterId]),
    )
    .subscribe()

  return () => {
    supabase.removeChannel(channel)
  }
}, [characterId])
```

React Query manages cache invalidation on realtime events.

### Image Generation + Storage

Avatar generation flow:

1. User enters prompt → check credits
2. Call Vertex AI image generation (`vertexAIService.generateImage`)
3. Upload to Supabase Storage (`imageStorageService.uploadImage`)
4. Update character record with public URL
5. Deduct credits via DB function

Storage buckets: `character-avatars`, `user-profile-images`. RLS policies match character ownership.

## Common Pitfalls

1. **Don't check subscription in `index.tsx`** - Only checks auth state. Terms/subscription checked inside `(app)/_layout.tsx` after authentication.

2. **Don't wait for JWT refresh after terms acceptance** - Use optimistic UI. User clicks accept → proceed immediately. DB write happens async. RLS enforces server-side.

3. **Don't query credits from Supabase on every render** - Read from JWT claims first (`useUserCredits` hook). Query DB only when performing operations that deduct credits.

4. **Don't forget to clear Expo cache** - If routing breaks, run `npx expo start --clear`. Expo Router generates types from file structure.

5. **Don't store large conversation history in character context** - Context field can grow unbounded. Prune old messages or use sliding window (last 10-20 messages) for AI context.

6. **Don't bypass `aiChatService`** - Always use `sendMessageWithAIResponse` to ensure proper message ordering, error handling, and credit deduction.

7. **Don't put Reanimated plugin anywhere but last in babel.config.js** - Must be final plugin or animations break.

## Testing Checklist

Before committing changes:

- [ ] Run `npm run typecheck` (no TypeScript errors)
- [ ] Test auth flow: sign in → accept terms → access app
- [ ] Test character creation + chat on iOS/Android/Web
- [ ] Verify subscription modal shows when credits exhausted
- [ ] Check realtime message sync works (open two devices)
- [ ] Test offline behavior (messages queue and sync)
- [ ] Clear cache and test fresh install: `npx expo start --clear`

## Stack-Specific Notes

### Expo Router (File-Based Routing)

- Dynamic routes: `[id].tsx` for `/characters/123`
- Groups: `(app)` and `(tabs)` organize without adding URL segments
- Navigation: Use `router.push()`, `router.back()`, `router.replace()`
- Types auto-generated: Change file structure → clear cache → types update

### React Native GiftedChat

- Requires `react-native-reanimated` and `react-native-gesture-handler`
- Messages in reverse chronological order (newest at index 0)
- Custom `renderBubble`, `renderSend` for theming
- Web support via CSS animations (native driver warning expected)

### Firebase + Supabase Hybrid

- Firebase handles auth (Google Sign-In, email/password)
- `exchangeToken` function creates Supabase JWT with subscription claims
- Supabase manages data with RLS policies reading JWT claims
- Never use Firebase for app data - only authentication

### Vertex AI Integration

- Requires Google Cloud project with Vertex AI API enabled
- Manages conversation context for character personality
- Fallback responses if API fails (stays in character)
- Character introduction messages generated on first chat

## Documentation Deep Dives

Read these for implementation details:

- `docs/NAVIGATION.md` - Complete navigation architecture with auth flow
- `docs/CHARACTERS.md` - Character data model, RLS policies, common queries
- `docs/SUPABASE_AUTH.md` - Multi-tenant subscription system with JWT claims
- `docs/IMAGE_GENERATION.md` - Image generation and storage integration
- `docs/PAYMENT_INTEGRATION.md` - Client-side payment flows

Key files for understanding data flows:

- `src/services/aiChatService.ts` - Message orchestration
- `src/hooks/useAIChat.ts` - Chat UI logic with AI responses
- `app/(app)/_layout.tsx` - Terms check and drawer navigation
- `app/(app)/(tabs)/characters/[id].tsx` - Character detail + chat UI

## App-Specific Constants

- **App name**: `yours-brightly` (used in all subscription checks)
- **Current terms version**: `1.0`
- **Credit costs**: Message (1 credit), Image generation (5 credits)
- **Free tier**: 50 credits
- **Character limits**: Name (30 chars), Appearance/Traits/Emotions (144 chars each)
- **Message history**: Last 10 messages included in AI context

## Documentation Guidelines

When creating or updating documentation:

1. **Create detailed docs in `/docs` folder** - All comprehensive documentation lives in individual markdown files in the `docs/` directory. Use descriptive filenames like `FEATURE_NAME.md` or `SYSTEM_NAME.md` in SCREAMING_SNAKE_CASE.

2. **Add summary + link to README** - After creating a doc file, add a brief 1-2 sentence summary and a link to it in the main `README.md` under the appropriate section (e.g., "Documentation Deep Dives", "Architecture", "Key Features").

3. **Doc structure** - Each documentation file should include:
   - Clear title and purpose
   - Table of contents for longer docs
   - Code examples with explanations
   - Common pitfalls or gotchas
   - Related files and their locations
   - Links to other relevant docs

4. **Keep README concise** - The README should be a high-level overview and index. Detailed implementation details belong in individual doc files, not the README.

5. **Update existing docs** - When making significant code changes, update the corresponding documentation in `/docs`. Don't let docs become stale.

6. **Example format**:
   ```markdown
   # Feature Name
   
   Brief description of what this feature does and why it exists.
   
   ## Overview
   - Key concept 1
   - Key concept 2
   
   ## Implementation
   Detailed explanation with code examples...
   
   ## Related Files
   - `src/path/to/file.ts` - What it does
   ```

7. **Link format in README**:
   ```markdown
   - **[Feature Name](docs/FEATURE_NAME.md)** - Brief 1-2 sentence description of what the doc covers.
   ```
