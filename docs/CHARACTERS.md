## Yours Brightly Characters

This document describes how character data is modeled, secured, and used in the Yours Brightly AI app. It reflects the multi-tenant Postgres structure and JWT-based RLS policies.

### Tables and View

- Table: `public.yours_brightly_characters`
	- id (uuid, pk)
	- user_id (uuid, fk → auth.users.id)
	- name (text, <= 30 chars)
	- avatar (text | null) — URL
	- appearance (text | null, <= 144 chars)
	- traits (text | null, <= 144 chars)
	- emotions (text | null, <= 144 chars)
	- context (text | null)
	- is_public (boolean)
	- created_at (timestamptz)
	- updated_at (timestamptz)

- Table: `public.yours_brightly_messages`
	- id (uuid, pk)
	- character_id (uuid, fk → yours_brightly_characters.id)
	- sender_user_id (uuid, fk → auth.users.id)
	- recipient_user_id (uuid, fk → auth.users.id)
	- message_id (text) — external message id (UUID string)
	- text (text)
	- created_at (timestamptz)
	- sender_name (text | null)
	- sender_avatar (text | null)
	- message_data (jsonb)

- View: `public.yours_brightly_messages_gifted_chat`
	- Same data as messages, projected to react-native-gifted-chat format:
		- _id (maps from message_id)
		- createdAt (maps from created_at)
		- user { _id, name, avatar }

### RLS (Row Level Security)

All tables have RLS enabled and rely on JWT claims and subscription checks.

Policies for `yours_brightly_characters`:

- Select own characters
	- USING: `auth.uid() = user_id AND user_has_app_access('yours-brightly')`
- Select public characters
	- USING: `is_public = true AND user_has_app_access('yours-brightly')`
- Insert/update/delete own characters
	- USING/CHECK: `auth.uid() = user_id AND user_has_app_access('yours-brightly')`

Policies for `yours_brightly_messages`:

- Select in conversations where caller is sender or recipient
	- USING: `(auth.uid() = sender_user_id OR auth.uid() = recipient_user_id) AND user_has_app_access('yours-brightly')`
- Insert/update/delete messages the caller sent
	- USING/CHECK: `auth.uid() = sender_user_id AND user_has_app_access('yours-brightly')`

Public/private control:

- Toggle `is_public` on a character to control visibility to other app users (still requires app access via RLS).

### TypeScript Types

Types live in `src/types/yoursbrightly.ts` and mirror the schema. Key types:

- `YoursbrightlyCharacter` — row shape of `yours_brightly_characters`
- `YoursbrightlyMessage` — row shape of `yours_brightly_messages`
- `YoursbrightlyMessageGiftedChat` — row shape of the gifted-chat view
- `CreateCharacterInput`, `UpdateCharacterInput` — safe inputs

### Supabase Client Types

`src/config/supabaseClient.ts` exposes `Database` with:

- Tables: `yours_brightly_characters`, `yours_brightly_messages`, `user_app_subscriptions`
- View: `yours_brightly_messages_gifted_chat`
- Functions: `user_has_app_access`, `get_user_character_count`, `get_character_message_count`

### Common Queries

- Create a character

```ts
const { data, error } = await supabaseClient
	.from('yours_brightly_characters')
	.insert({
		name: 'Alice',
		appearance: 'Tall with long brown hair',
		traits: 'Kind, curious, adventurous',
		emotions: 'Excited and optimistic',
		is_public: false,
	})
	.select()
	.single()
```

- List my characters (ordered by newest)

```ts
const { data, error } = await supabaseClient
	.from('yours_brightly_characters')
	.select('*')
	.eq('user_id', userId)
	.order('created_at', { ascending: false })
```

- Toggle public/private

```ts
await supabaseClient
	.from('yours_brightly_characters')
	.update({ is_public: true })
	.eq('id', characterId)
```

- Fetch gifted-chat messages for a character

```ts
const { data, error } = await supabaseClient
	.from('yours_brightly_messages_gifted_chat')
	.select('*')
	.eq('character_id', characterId)
	.order('createdAt', { ascending: false })
	.limit(50)
```

### Notes

- All access is gated by `user_has_app_access('yours-brightly')` via JWT claims injected by the auth hook.
- The `context` field can grow large; monitor and prune as needed.
- The gifted-chat view avoids client-side mapping of message shapes.

