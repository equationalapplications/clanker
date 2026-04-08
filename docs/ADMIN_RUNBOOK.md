# Admin Runbook

## Purpose

Operational procedures for high-impact admin actions, especially reset and delete.

## Access Preconditions

1. Confirm admin has authenticated with Firebase on web.
2. Confirm admin user is authorized (custom claim or allowlist).
3. Confirm `EXPO_PUBLIC_ADMIN_DASHBOARD_ENABLED=true` for the web environment.

## Pre-Action Checklist

1. Identify target user id and email from the directory table.
2. Verify requested action and reason in a support ticket or incident artifact.
3. Confirm consequences with a second reviewer for destructive operations.

## Action Procedures

### Adjust Credits

1. Select user.
2. Enter absolute credit value.
3. Confirm action and include a reason.
4. Validate updated credits in the refreshed row.

### Adjust Subscription

1. Select tier and status.
2. Optionally set renewal date.
3. Confirm action and include a reason.
4. Validate updated tier/status in the refreshed row.

### Clear Terms Acceptance

1. Select user.
2. Trigger clear terms action.
3. Confirm action and include a reason.
4. Validate terms fields are unset.

### Reset User State

1. Trigger reset action.
2. Type `RESET` in confirmation modal.
3. Provide reason and confirm.
4. Validate row returns to free/active with credits=50 and terms cleared.

### Delete User Permanently

1. Trigger delete action.
2. Type `DELETE` in confirmation modal.
3. Provide reason and confirm.
4. Validate user no longer appears in the list after refresh.

## Post-Action Validation

1. Review Cloud Function logs for `admin_audit_event` and function success completion.
2. Ensure no repeated invocation errors for the same request id.
3. Update incident/support ticket with actor, timestamp, and request id.

## Failure Handling

1. If a mutation fails, capture error text and request id.
2. Retry only after confirming idempotency intent and impact.
3. Escalate persistent failures to backend owner and include function logs.
