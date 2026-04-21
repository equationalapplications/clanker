# Admin Dashboard (Web Only)

## Overview

The admin dashboard is a web-only control plane for privileged account operations.
It is implemented as an Expo Router route at `app/admin/index.tsx` and intentionally blocked on non-web platforms.

## Route And Access Model

- Route: `/admin`
- Platform gate: `Platform.OS === 'web'`
- Auth gate: requires signed-in Firebase user
- Authorization gate: dashboard performs a server-validated admin access check through `adminListUsers`

If any gate fails, the page renders a blocked state and never shows mutation controls.

## UI Structure

The dashboard is split into three reusable pieces:

- `UsersTable`: paginated user directory and row selection
- `UserActionPanel`: action controls for credits, subscription, terms, reset, and delete
- `AdminConfirmationModal`: required confirmation for every mutating operation

## Confirmation Rules

All mutations are confirmation-gated:

- Credits update: confirmation + reason
- Subscription update: confirmation + reason
- Clear terms: confirmation + reason
- Reset user: confirmation + reason + typed `RESET`
- Delete user: confirmation + reason + typed `DELETE`

Submit remains disabled until all validation requirements are satisfied.

## State And Data Fetching

- React Query hooks in `src/hooks/useAdminDashboard.ts` provide:
  - access check
  - paginated list fetch
  - mutation handlers with invalidation
- Firebase callable wrappers are in `src/services/adminService.ts`
- Shared admin data contracts are in `src/types/admin.ts`

## Search And Filter Semantics

- Email/name search is server-side: the dashboard passes `search` to `adminListUsers`, which executes Cloud SQL-backed user directory search.
- Search input is debounced on the client (`300ms`) to avoid excessive function calls while typing.
- Plan filters (`planTier`, `planStatus`) remain page-scoped client-side filters because they come from hydrated Cloud SQL subscription data, not base identity fields.
- Query transitions use React Query `keepPreviousData` so page/filter changes do not flash an empty loading state.
- Pagination supports page size selection (`25`, `50`, `100`) and resets to page 1 when search/filters/page-size change.

## Operational Notes

- App Check is awaited before admin callable execution.
- Client sends generated `requestId` for all mutation calls for audit correlation.
- UI shows success/failure feedback after each action.

Current user directory search and plan filters are applied to the currently fetched page of users.
