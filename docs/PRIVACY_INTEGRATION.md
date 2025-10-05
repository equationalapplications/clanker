# Privacy Policy Integration Guide

This document explains how privacy policy content is centralized and integrated into the app. Privacy is intentionally simpler than terms: there is no versioning or forced re-acceptance flow.

## Files

- `app/config/privacyConfig.ts`
  - Single source of truth for the privacy policy text and metadata (version is optional; not used to force re-acceptance).
  - Exports a `PrivacyConfig` object and a `getPrivacyForApp(appName: string)` helper.

- `app/screens/Privacy.tsx`
  - Full-screen display of the privacy policy. It reads `getPrivacyForApp('yours-brightly')` and renders the text.
  - Does not perform version checks or force re-acceptance.

- Privacy notices can be shown in subscription management flows if needed.

## Integration Steps

1. Centralize the privacy text in `app/config/privacyConfig.ts`:

```ts
export interface PrivacyConfig {
  lastUpdated?: string
  privacy: string
  summary?: string
  version?: string // optional, not used for gating
}

export const YOURS_BRIGHTLY_PRIVACY: PrivacyConfig = {
  lastUpdated: 'September 28, 2025',
  summary: 'Short blurb about data handling and user privacy.',
  privacy: `Full privacy policy text...`
}

export const CURRENT_PRIVACY = YOURS_BRIGHTLY_PRIVACY
export function getPrivacyForApp(appName: string) { return YOURS_BRIGHTLY_PRIVACY }
```

2. Render it in the `Privacy` screen:

- Use a `ScrollView` and `Text` components to present the full `privacy` string.
- Display `lastUpdated` in the header for reference.
- No accept/decline flow is necessary.

3. Link from Sign-In or Settings:

- Provide navigation to the privacy screen, e.g. `navigation.navigate('Privacy')`.
- Optionally show the `summary` in a modal or alongside terms links.

## User Flow

- User clicks "Privacy Policy" → App navigates to `Privacy` screen → User reads the policy.
- No version checks or re-acceptance required.

## Notes and Recommendations

- Because privacy is not gated by versioning, updates to the privacy text do not require users to take action. If you ever need to require acknowledgement, promote `privacyConfig` to include a `version` and implement a light acceptance flow similar to `termsConfig`.

- Keep privacy wording clear and concise. Ensure `privacyConfig.privacy` contains the authoritative, legal text.

- Store the centralized config in version control so audit history is preserved.
