# Auth Provider Name Sync

This app now captures and persists user names from social providers during sign-in:

- Apple (native iOS): reads `FULL_NAME` from Authentication Services on first authorization and stores it on the Firebase user profile.
- Apple (web): requests `name` scope and persists returned profile name to Firebase when available.
- Google (native): backfills Firebase `displayName` from Google profile payload when Firebase does not populate it automatically.

After authentication, the app syncs Firebase identity fields into the Cloud SQL `users` profile data while preserving user customizations:

- Fills `display_name` only when it is currently empty.
- Fills `email` only when it is currently empty.
- Fills `avatar_url` only when it is currently empty.

## Profile UI behavior

The profile header now renders:

- Bold display name line only when a name exists.
- Email line below the name when email exists.
- No duplicate email-as-name fallback.

## Why this matters

- Meets Sign in with Apple UX expectations by retaining user-provided name.
- Ensures consistent identity display across provider types.
- Avoids overwriting user-edited profile values after first sync.
