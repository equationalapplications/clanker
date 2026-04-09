# Support Page

This document describes the in-app support page used for App Store Connect's Support URL requirement.

## Goal

Provide a direct, app-specific support destination whose primary function is helping end users.

Apple requirement reference:

> Provide a Support URL that provides a direct link to a page specific for your app and/or service that provides Support to the end user as its primary function.

## Route and Accessibility

- Route: `/support`
- File: `app/support.tsx`
- Registration: `app/_layout.tsx` as a top-level `Stack.Screen`

The route is intentionally public and not behind auth guards, so it can be opened directly by a user or reviewer.

## In-App Entry Point

- Settings screen link in the About section
- File: `app/(drawer)/settings.tsx`

The support page is intentionally not linked from the sign-in screen.

## Support Content

The page includes:

- Primary contact method: `info@equationalapplications.com`
- Direct Email Support button (`mailto:info@equationalapplications.com`)
- FAQ entries covering:
  - credits and subscriptions
  - sign-in guidance
  - account deletion requests
  - how to contact support effectively

## Maintenance Notes

- Keep FAQ answers short and user-facing.
- Keep the support email consistent with policy/compliance documents.
- If support workflows change, update this page before App Store metadata updates.