# Multi-Tenant Authentication System with Firebase + Supabase

This document describes our comprehensive multi-tenant authentication system that combines Firebase Authentication with Supabase for data access control, including terms acceptance enforcement and JWT-based Row Level Security.

## 🏗️ Architecture Overview

### Hybrid Authentication Flow
1. **Firebase Authentication**: Primary authentication provider (Google Sign-In, Email, etc.)
2. **Token Exchange**: Firebase Function generates pre-signed Supabase JWTs with custom claims
3. **Supabase Session**: Client establishes Supabase session with Firebase-generated JWT
4. **Row Level Security**: Database access controlled by JWT custom claims

### Core Components
- **Firebase Functions**: `exchangeToken` function for JWT generation and user management
- **Supabase Database**: Multi-tenant schema with terms acceptance tracking
- **JWT Custom Claims**: Apps array for per-app access control
- **Terms Versioning**: Enforced acceptance of current terms before granting app access

---

## 🗄️ Database Schema

### Core Tables

#### `user_app_permissions`
Tracks which applications users have access to and their terms acceptance status.

```sql
CREATE TABLE public.user_app_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    app_name TEXT NOT NULL,
    granted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    terms_accepted_at TIMESTAMP WITH TIME ZONE,  -- NULL = terms not accepted
    terms_version TEXT,                          -- Version of terms accepted
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(user_id, app_name)  -- One record per user per app
);
```

#### `yours_brightly` (Example App Table)
App-specific data table protected by RLS policies.

```sql
CREATE TABLE public.yours_brightly (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    display_name TEXT,
    preferences JSONB DEFAULT '{}',
    profile_data JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(user_id)  -- One record per user
);
```

---

## 🔑 Authentication Functions

### Core Functions

#### `get_user_apps(user_id UUID) RETURNS TEXT[]`
Returns array of app names user has access to (only apps with accepted terms).

```sql
CREATE OR REPLACE FUNCTION public.get_user_apps(user_id UUID)
RETURNS TEXT[] AS $$
BEGIN
    RETURN ARRAY(
        SELECT app_name 
        FROM public.user_app_permissions 
        WHERE user_app_permissions.user_id = get_user_apps.user_id
        AND terms_accepted_at IS NOT NULL  -- Only apps with accepted terms
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

#### `grant_app_access(p_user_id UUID, p_app_name TEXT, p_terms_version TEXT)`
Records terms acceptance and grants app access.

```sql
-- Called when user accepts terms
-- Creates user_app_permissions record with terms_accepted_at = NOW()
-- Also creates app-specific user record (e.g., yours_brightly table)
```

#### `check_terms_acceptance_required(p_user_id UUID, p_app_name TEXT, p_current_terms_version TEXT)`
Checks if user needs to accept current terms version.

```sql
-- Returns TRUE if:
-- 1. No permission record exists
-- 2. terms_accepted_at is NULL
-- 3. terms_version != current version
```

#### `revoke_app_access(p_user_id UUID, p_app_name TEXT)`
Removes user access to an app (admin function).

---

## 🔥 Firebase Integration

### exchangeToken Cloud Function

Located in `functions/src/exchangeToken.ts`, this function:

1. **Validates Firebase Authentication**: Verifies Firebase ID token
2. **User Management**: Creates/finds Supabase user via Admin API
3. **Permission Query**: Fetches user's app permissions from `user_app_permissions`
4. **Terms Validation**: Only includes apps where `terms_accepted_at IS NOT NULL`
5. **Dual Token Generation**: Creates both access and refresh tokens

#### Token Generation
```typescript
// Access Token (1 hour) - Full claims with apps array
const accessPayload = {
    sub: supabaseUserId,
    role: "authenticated",
    iat: now,
    exp: now + 3600,  // 1 hour
    aud: "authenticated",
    email: userEmail,
    apps: userApps,        // ['yours-brightly'] if terms accepted
    token_type: "access"
};

// Refresh Token (24 hours) - Minimal claims
const refreshPayload = {
    sub: supabaseUserId,
    role: "authenticated", 
    iat: now,
    exp: now + 86400,     // 24 hours
    aud: "authenticated",
    token_type: "refresh"
};
```

#### Environment Variables Required
```bash
SUPABASE_JWT_SECRET=your_jwt_secret
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key  
SUPABASE_URL=your_supabase_url
```

---

## 🔒 Row Level Security (RLS) Policies

### Multi-Tenant Access Control

All app-specific tables use RLS policies that check the `apps` array in the JWT:

```sql
-- Example: yours_brightly table policies
CREATE POLICY "Users with yours-brightly access can view their data" 
ON public.yours_brightly FOR SELECT USING (
    auth.uid() = user_id 
    AND EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(
            COALESCE(auth.jwt() -> 'apps', '[]')
        ) AS app 
        WHERE app = 'yours-brightly'
    )
);
```

### Policy Pattern
1. **User Ownership**: `auth.uid() = user_id` (user can only access their own data)
2. **App Permission**: JWT must contain the specific app name in `apps` array
3. **Applied to All Operations**: SELECT, INSERT, UPDATE, DELETE

---

## 📋 Terms Acceptance System

### Terms Lifecycle

1. **New User**: No app permissions, JWT contains `apps: []`
2. **Terms Presented**: Client shows terms modal with current version
3. **Terms Accepted**: Calls `grant_app_access()` function
4. **Access Granted**: Next JWT refresh includes app in `apps` array
5. **Version Update**: When terms version changes, user must re-accept

### Version Management

#### Client-Side Hook (`useAcceptTerms`)
```typescript
const CURRENT_TERMS_VERSION = '2.0';  // Update this to force re-acceptance

export function useAcceptTerms() {
    // Checks if user's accepted version matches current version
    // Returns needsAcceptance: boolean
}
```

#### Terms Modal Integration
```typescript
<TermsGate onTermsAccepted={() => console.log('Access granted!')}>
    <YourAppContent />
</TermsGate>
```

---

## 🚀 Client Implementation

### Authentication Flow

#### 1. Firebase Authentication
```typescript
// User signs in with Firebase (Google, email, etc.)
import { signInWithPopup, GoogleAuthProvider } from 'firebase/auth';
```

#### 2. Token Exchange
```typescript
// Exchange Firebase token for Supabase JWT
import { loginToSupabaseAfterFirebase } from './utilities/loginToSupabaseAfterFirebase';

const authData = await loginToSupabaseAfterFirebase();
// Returns: { supabaseAccessToken, supabaseRefreshToken }
```

#### 3. Supabase Session
```typescript
// Establish Supabase session with dual tokens
await supabase.auth.setSession({
    access_token: supabaseAccessToken,   // 1 hour with full claims
    refresh_token: supabaseRefreshToken  // 24 hours for renewal
});
```

### JWT Claims Structure

#### Access Token Claims
```json
{
    "sub": "user-uuid",
    "role": "authenticated", 
    "iat": 1234567890,
    "exp": 1234571490,
    "aud": "authenticated",
    "email": "user@example.com",
    "apps": ["yours-brightly"],      // ⭐ Key for RLS
    "token_type": "access"
}
```

#### Refresh Token Claims
```json
{
    "sub": "user-uuid",
    "role": "authenticated",
    "iat": 1234567890, 
    "exp": 1234654290,
    "aud": "authenticated",
    "token_type": "refresh"
}
```

---

## 🛠️ Development Workflow

### Adding a New App

1. **Update App Names**: Add new app name to your constants
2. **Create App Table**: 
   ```sql
   CREATE TABLE public.new_app (
       user_id UUID NOT NULL REFERENCES auth.users(id),
       -- app-specific fields
   );
   ```
3. **Add RLS Policies**: Copy and modify existing policies for new app
4. **Update Functions**: Modify `grant_app_access()` to handle new app
5. **Client Integration**: Add terms acceptance for new app

### Testing Authentication

#### Check JWT Claims
```javascript
// In browser console
const session = await supabase.auth.getSession();
const token = session.data.session?.access_token;
const payload = JSON.parse(atob(token.split('.')[1]));
console.log('JWT Claims:', payload);
```

#### Test RLS Policies
```sql
-- Simulate user session
SELECT auth.jwt() -> 'apps';  -- Should show user's apps array
SELECT * FROM yours_brightly; -- Should only show user's data if they have access
```

---

## 🔍 Debugging Guide

### Common Issues

#### User Can't Access Data
1. **Check JWT Claims**: Verify `apps` array contains required app name
2. **Check Terms Acceptance**: Ensure `terms_accepted_at` is not null
3. **Check RLS Policies**: Verify policies are correctly checking JWT claims

#### Terms Not Enforced
1. **Check Function**: Ensure `get_user_apps()` filters by `terms_accepted_at IS NOT NULL`
2. **Check Migration**: Verify new migration was applied with `supabase db push`
3. **Check JWT Generation**: Ensure `exchangeToken` uses updated query with terms filter

#### Logging Points
```typescript
// Client-side debugging
console.log('🔐 JWT Payload:', tokenPayload);
console.log('📋 Terms Status:', { needsAcceptance, currentVersion });
console.log('✅ Session Active:', !!supabaseSession);
```

---

## 📊 Monitoring & Analytics

### Key Metrics to Track
- **Terms Acceptance Rate**: % of users who accept terms
- **Version Update Impact**: Users affected by terms version changes  
- **JWT Refresh Success**: Token renewal success rate
- **RLS Policy Violations**: Failed data access attempts

### Database Queries for Insights
```sql
-- Users by terms acceptance status
SELECT 
    app_name,
    COUNT(*) FILTER (WHERE terms_accepted_at IS NOT NULL) as accepted,
    COUNT(*) FILTER (WHERE terms_accepted_at IS NULL) as pending
FROM user_app_permissions 
GROUP BY app_name;

-- Terms version distribution  
SELECT terms_version, COUNT(*) 
FROM user_app_permissions 
WHERE app_name = 'yours-brightly'
GROUP BY terms_version;
```

---

## 🚨 Security Considerations

### JWT Security
- ✅ **Short Access Token Lifetime**: 1 hour limits exposure window
- ✅ **Longer Refresh Token**: 24 hours reduces re-authentication friction  
- ✅ **Minimal Refresh Claims**: Refresh tokens contain minimal data
- ✅ **Server-Side Generation**: JWTs generated by secure Firebase Function

### RLS Best Practices  
- ✅ **Double-Check Ownership**: Always verify `auth.uid() = user_id`
- ✅ **App Permission Check**: Always verify app access via JWT claims
- ✅ **Terms Enforcement**: Only grant access with accepted terms
- ✅ **Policy Testing**: Test policies with different user scenarios

### Terms Compliance
- ✅ **Version Tracking**: Full audit trail of terms acceptance
- ✅ **Forced Re-acceptance**: Users must accept updated terms
- ✅ **Access Revocation**: Automatic access removal without current terms
- ✅ **Granular Control**: Per-app terms acceptance tracking

---

This system provides enterprise-grade multi-tenant authentication with comprehensive terms management, ensuring both security and compliance while maintaining excellent user experience.
