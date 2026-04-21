# Cloud Character Save + Share

This feature adds explicit, subscription-gated cloud persistence and sharing for characters. Cloud character behavior is opt-in per character (default off), and only available to active `monthly_20` or `monthly_50` users.

## What changed

- Character edit screen now includes:
  - `Save to Cloud` toggle (subscription-gated with subscribe CTA toast)
  - `Make Character Sharable` toggle (disabled unless cloud-save is enabled)
  - Share button (shown only for sharable characters)
- Share flow provides a social-friendly card with:
  - Character avatar
  - Character name
  - Public share URL using cloud UUID (`/characters/shared/{id}`)
  - QR code for the URL
- Characters list screen now includes `Retrieve from Cloud`:
  - Subscription-gated with toast + subscribe action
  - Imports latest cloud characters into local storage
- App deep-link route added:
  - `/characters/shared/[id]` imports a public cloud character and opens chat

## Subscription gating

Cloud character operations are enforced in both client and backend callables:

- Allowed plans: `monthly_20`, `monthly_50`
- Required status: `active`

This applies to:

- `syncCharacter`
- `getUserCharacters`
- `getPublicCharacter`

## Local data model changes

SQLite `characters` now has a dedicated `save_to_cloud` flag:

- Column: `save_to_cloud INTEGER DEFAULT 0`
- Schema version bumped to `5`
- Existing rows default to cloud-save off after migration

Sync behavior now filters to rows with:

- `synced_to_cloud = 0`
- `save_to_cloud = 1`
- not soft-deleted

This ensures characters are **not** cloud-synced by default.

## Shared character import behavior

When a user opens a shared character link:

- The app calls `getPublicCharacter(characterId)`
- Character is imported/updated in local SQLite
- User is routed to that character chat

Imported shared characters are local copies with cloud-save disabled by default (`save_to_cloud = 0`).

## Share URL and deep links

Share URL generation uses:

- `EXPO_PUBLIC_CHARACTER_SHARE_BASE_URL` (optional)
- Fallback: `https://clanker.app`

Utility helpers generate:

- Web share URL
- Native deep link (`com.equationalapplications.clanker://...`)
- QR code image URL for sharing card rendering
