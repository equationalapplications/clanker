# Terms Acceptance Integration Guide

This guide shows how to integrate the terms acceptance system with centralized terms configuration.

## Components Overview

### 1. Terms Configuration (`app/config/termsConfig.ts`)
Centralized configuration for all terms:
```tsx
export interface TermsConfig {
  version: string;     // Version for tracking changes
  summary: string;     // Short summary for modal
  terms: string;       // Full terms text  
  lastUpdated: string; // Date for reference
}
```

### 2. AcceptTermsModal
Shows a summary of terms with:
- Key points from `termsConfig.summary`
- Version information from `termsConfig.version`
- "View Full Terms" button for navigation to full terms
- Accept/Decline actions with database integration

### 3. TermsGate
Wrapper component that:
- Uses `CURRENT_TERMS.version` for version checking
- Automatically shows modal when terms acceptance is needed
- Handles navigation to full terms page via `onNavigateToTerms`
- Manages terms acceptance state and JWT refresh

### 4. Terms Screen
Your Terms.tsx screen now:
- Uses `getTermsForApp('yours-brightly')` to get current terms
- Displays `termsConfig.terms` (full terms text)
- Automatically stays in sync with configuration

## Updating Terms

### Step 1: Update the configuration
Edit `app/config/termsConfig.ts`:

```tsx
export const YOURS_BRIGHTLY_TERMS: TermsConfig = {
  version: '3.0', // ⭐ Increment this to force re-acceptance
  lastUpdated: 'October 15, 2025',
  
  summary: `
Updated key points:
• New AI features and usage guidelines
• Updated data handling policies
• Revised subscription terms
...
`,
  
  terms: `
Full updated terms text...
`
};
```

### Step 2: That's it!
- ✅ Modal automatically shows new summary
- ✅ Version checking forces user re-acceptance  
- ✅ Terms screen shows updated full terms
- ✅ JWT refresh includes new permissions
- ✅ All components stay in sync

## Integration Steps

### Step 1: Wrap your app with TermsGate

```tsx
import { TermsGate } from '../components/TermsGate';
import { useNavigation } from '@react-navigation/native';

function App() {
  const navigation = useNavigation();

  const handleNavigateToTerms = () => {
    navigation.navigate('Terms'); // Navigate to Terms screen
  };

  return (
    <TermsGate
      appName="yours-brightly"
      onNavigateToTerms={handleNavigateToTerms}
      onTermsAccepted={() => console.log('Terms accepted!')}
    >
      <YourMainAppContent />
    </TermsGate>
  );
}
```

### Step 2: Ensure Terms screen is in your navigator

```tsx
// In your navigator setup
import Terms from '../screens/Terms';

<Stack.Navigator>
  <Stack.Screen 
    name="Terms" 
    component={Terms}
    options={{ title: 'Terms of Service' }}
  />
  {/* other screens */}
</Stack.Navigator>
```

## User Flow

1. **User opens app** → TermsGate checks if `CURRENT_TERMS.version` accepted
2. **Terms required** → AcceptTermsModal shows `termsConfig.summary`
3. **User taps "View Full Terms"** → Navigates to Terms screen
4. **Terms screen** → Shows `termsConfig.terms` (full text)
5. **Terms accepted** → JWT refreshed with app permissions

## Version Management

### Automatic Re-acceptance
When you update `CURRENT_TERMS.version`:
- All users must re-accept before gaining app access
- `useAcceptTerms` hook detects version mismatch
- Modal shows automatically with "Updated Terms" messaging
- JWT claims only granted after acceptance of current version

### Development Workflow
1. **Draft new terms** in your preferred editor
2. **Update `termsConfig.ts`** with new version and content
3. **Test locally** - version mismatch forces modal
4. **Deploy** - all users see updated terms on next app launch

## Configuration Structure

```tsx
// Single source of truth for all terms
export const YOURS_BRIGHTLY_TERMS: TermsConfig = {
  version: '2.0',
  lastUpdated: 'September 28, 2025',
  summary: `Brief key points for modal...`,
  terms: `Complete legal terms text...`
};

// Current active terms (easy to switch for testing)
export const CURRENT_TERMS = YOURS_BRIGHTLY_TERMS;

// Helper function for multiple apps (future-proofing)
export function getTermsForApp(appName: string): TermsConfig | null {
  switch (appName) {
    case 'yours-brightly': return YOURS_BRIGHTLY_TERMS;
    // case 'other-app': return OTHER_APP_TERMS;
    default: return null;
  }
}
```

## Benefits

- ✅ **Single Source of Truth**: All terms content in one file
- ✅ **Version Control**: Easy tracking and forced re-acceptance
- ✅ **Developer Experience**: Simple updates, automatic propagation
- ✅ **User Experience**: Consistent terms display across app
- ✅ **Legal Compliance**: Comprehensive tracking and enforcement
- ✅ **Maintainability**: Centralized configuration, easy updates

## Notes

- The modal shows `summary`, the Terms screen shows `terms`
- Version changes in `termsConfig.ts` force all users to re-accept
- Terms acceptance is recorded in `user_app_permissions` table with version
- JWT is automatically refreshed after acceptance
- All components automatically stay in sync with configuration updates