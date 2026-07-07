# Privacy Update Design Spec

**Date:** 2026-07-07  
**Branch:** privacy-updates  
**Status:** Implemented

## Overview

Update Clanker's privacy policy and app store disclosures to address compliance gaps identified during buyer due diligence preparation. This spec covers:

1. Adding Crashlytics documentation (currently missing from privacy policy)
2. Updating Analytics section (currently says "not currently active")
3. Adding Payment Processing section (Stripe details)
4. Updating Data Deletion section (adding in-app deletion flow)
5. App store compliance checklists (Apple App Store + Google Play)

**Motivation:** App store privacy labels require accurate disclosure of all data collection, including third-party SDKs. Buyer due diligence requires documented privacy-by-design practices.

## Design Rationale

| Decision | Why |
|----------|-----|
| Comprehensive privacy spec (Option A) | Buyer due diligence needs single source of truth for all privacy practices |
| Crashlytics opt-in documented | GDPR/CCPA require explicit consent; app store labels must declare "Optional" |
| Stripe details added | Current policy mentions "payment information" but doesn't detail processor |
| Data deletion flow documented | GDPR Article 17 / CCPA "right to delete"; Apple/Google require clear deletion mechanism |
| Firebase SDK deferral required | SDKs must NOT initialize before consent; otherwise "Optional" becomes "Required" |

## Architecture

### Files to Modify

1. **`src/config/privacyConfig.ts`** — Privacy policy text
2. **`src/services/crashlyticsService.ts`** — Verify opt-in default
3. **`src/services/analyticsService.ts`** — Verify opt-in default
4. **`src/contexts/SettingsContext.tsx`** — Verify toggles default to OFF
5. **App Store Connect** — Update "App Privacy" section
6. **Google Play Console** — Update "Data Safety" form

### Firebase SDK Initialization Order

**CRITICAL:** SDKs must NOT initialize before user consent.

Current flow (to verify):
1. App launches
2. `initializeCrashlytics()` reads `Storage.getItemSync(ANALYTICS_KEY)`
3. If `raw === '1'`, enable Crashlytics; otherwise disable
4. User sees cookie consent banner (web) or settings toggle (native)
5. User opts in → `setCrashlyticsEnabled(true)` / `setAnalyticsEnabled(true)`

**Required behavior:**
- New users: Crashlytics = disabled, Analytics = disabled (until consent)
- Existing users: Respect persisted choice
- SDKs must not send data before `setCrashlyticsCollectionEnabled(true)`

## Privacy Policy Text Changes

### 1. Add Crashlytics Section

**Location:** After "AI Processing of Chat Content" section

**Text:**
```
Crash Reporting and Diagnostics

To ensure the stability and reliability of the App, we use Firebase Crashlytics, 
a crash reporting service provided by Google LLC. If the App crashes or encounters 
an error, Crashlytics automatically collects diagnostic information to help us identify, 
troubleshoot, and resolve the issue.

The information collected does not include your name or email, but may include your 
device's Internet Protocol (IP) address, hardware model, operating system version, 
a unique device installation identifier (UUID), and the state of the App at the time 
of the crash. This diagnostic data is transmitted to and stored by Google in 
accordance with the Google Privacy Policy.

Crash reporting is disabled by default. We rely on your explicit consent before 
collecting this diagnostic data. You can enable or disable crash reporting at any 
time within the App's settings.
```

### 2. Update Analytics Section

**Location:** "Cookies and Similar Technologies (Web Only)" → Analytics bullet

**Current text:**
```
- Analytics: helps us understand product usage to improve the app (off by default,
  not currently active).
```

**Updated text:**
```
- Analytics: helps us understand product usage to improve the app (off by default,
  requires explicit opt-in).
```

### 3. Add Payment Processing Section

**Location:** After "How We Share Your Information" section

**Text:**
```
Payment Processing

We use Stripe, a third-party payment processor, to handle securely all payment 
transactions. When you make a purchase, you provide your payment details directly 
to Stripe. We do not collect, process, or store your full credit card numbers or 
bank account information on our servers.

The payment information you provide to Stripe is governed by Stripe's Privacy Policy 
(https://stripe.com/privacy). We only receive limited information from Stripe, such 
as payment confirmation, the last four digits of your card, and billing zip code, 
which we use solely to fulfill your order, prevent fraud, and maintain transaction 
records for tax and legal purposes.
```

### 4. Update Data Deletion Section

**Location:** "Data Deletion" section

**Current text:**
```
Data Deletion
If you wish to have your data deleted, please contact us at
[EMAIL].
```

**Updated text:**
```
Your Data Rights and Account Deletion

You have the right to access, update, or delete the personal information we hold 
about you.

How to request deletion: You can delete your account and associated personal data 
at any time directly within the App by navigating to Settings > Account > Delete 
Account. Alternatively, you can request data deletion by contacting us at [EMAIL].

What happens when you delete your account: Upon receiving a deletion request, we 
will promptly delete your account and personal data from our active databases. Please 
note that we may retain certain limited information (such as transaction records) for 
a period of time as required by law, for tax and accounting purposes, or to resolve 
disputes.
```

### 5. Increment Version

**Current:**
```typescript
export const PRIVACY: PrivacyConfig = {
  version: '1.7',
  lastUpdated: 'July 4, 2026',
  // ...
}
```

**Updated:**
```typescript
export const PRIVACY: PrivacyConfig = {
  version: '1.8',
  lastUpdated: 'July 7, 2026',
  // ...
}
```

## App Store Compliance

### Apple App Store Connect

Navigate to: *App Store Connect → Your App → App Privacy*

| Data Type | Collected By | Optional/Required | Linked to User? | Used for Tracking? | Purpose |
|-----------|----------------|---------------------|-------------------|---------------------|----------|
| **Diagnostics → Crash Data** | Firebase Crashlytics | **Optional** (opt-in) | **No** | No | Analytics, App Functionality |
| **Usage Data → Product Interaction** | Firebase Analytics | **Optional** (opt-in) | **Yes** (if logged in) | No | Analytics |
| **Identifiers → Device ID** | Firebase Analytics | **Optional** (opt-in) | **Yes** (if logged in) | No | Analytics |
| **Financial Info → Payment Info** | Stripe | **Required** (for purchases) | **Yes** | No | App Functionality |
| **Contact Info → Email, Name** | Stripe | **Required** (for purchases) | **Yes** | No | App Functionality |
| **Identifiers → User ID** | Stripe | **Required** (for purchases) | **Yes** | No | Fraud Prevention |

### Google Play Console

Navigate to: *Google Play Console → Your App → Policy and Programs → App Content → Data Safety*

**Data Collection and Security Section:**

| Question | Answer |
|----------|--------|
| Is data encrypted in transit? | **Yes** (Firebase and Stripe enforce HTTPS) |
| Do you provide a way for users to request data deletion? | **Yes** (Delete Account in Settings) |

**Data Types:**

| Category | Data Type | Collected By | Optional/Required | Purpose |
|----------|----------|----------------|---------------------|----------|
| **App info and performance** | Crash logs, Diagnostics | Firebase Crashlytics | **Optional** (opt-in) | App functionality, Analytics |
| **App info and performance** | Device or other IDs | Firebase Crashlytics | **Optional** (opt-in) | App functionality |
| **App activity** | App interactions | Firebase Analytics | **Optional** (opt-in) | Analytics |
| **App activity** | Device or other IDs | Firebase Analytics | **Optional** (opt-in) | Analytics |
| **Financial info** | User payment info | Stripe | **Required** (for purchases) | App functionality, Fraud prevention |
| **Personal info** | Name, Email address | Stripe | **Required** (for purchases) | App functionality |
| **Device or other IDs** | Device ID (fraud prevention) | Stripe | **Required** (for purchases) | Fraud prevention, security |

## Implementation Verification Checklist

Before submitting to app stores, verify:

- [ ] **Crashlytics toggle** in Settings defaults to OFF for new users
- [ ] **Analytics toggle** in Settings defaults to OFF for new users  
- [ ] **Firebase SDKs** do NOT initialize before user consents (check `initializeCrashlytics()` and `setAnalyticsEnabled()` flow)
- [ ] **"Delete Account"** button exists in Settings → Account and triggers deletion API
- [ ] **Privacy Policy** link is visible in App Settings
- [ ] **Cookie Preferences** link works on web (footer + Settings)
- [ ] **`[EMAIL]` placeholder** replaced with actual support email in `privacyConfig.ts`

## Firebase SDK Deferral Guidance

To ensure SDKs don't initialize before consent:

1. **Native (iOS/Android):**
   - In `app.json` or `firebase.json`, set `crashlytics_auto_collection_enabled: false`
   - In `crashlyticsService.ts`, `initializeCrashlytics()` reads persisted preference BEFORE enabling
   - SDK won't send data until `setCrashlyticsCollectionEnabled(true)` is called

2. **Web:**
   - In `firebaseConfig.web.ts`, don't initialize Analytics in the root config
   - In `analyticsService.web.ts`, defer `getAnalytics()` until consent is granted
   - Use a queue pattern: store `logEvent` calls until initialization completes

3. **Testing:**
   - Create new user account
   - Verify no network requests to `app-measurement.com` (Analytics) or `crashlytics.googleapis.com` (Crashlytics) before consent
   - Opt-in, verify requests start
   - Opt-out, verify requests stop

## Next Steps

1. Implement `privacyConfig.ts` text changes
2. Verify Firebase SDK initialization order
3. Update App Store Connect and Google Play Console
4. Test new user flow (no data sent before consent)
5. Commit spec and implementation
6. Invoke `writing-plans` skill for detailed implementation plan

---

**Spec approved by:** [User]  
**Date:** 2026-07-07
