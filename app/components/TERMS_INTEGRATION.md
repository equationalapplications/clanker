# Terms Acceptance Integration Guide

This guide shows how to integrate the terms acceptance system with your existing Terms screen.

## Components Overview

### 1. AcceptTermsModal
Shows a summary of terms with:
- Key points in bullet format
- Scroll-to-bottom validation
- "View Full Terms" button that calls `onViewFullTerms`
- Accept/Decline actions

### 2. TermsGate
Wrapper component that:
- Automatically shows modal when terms acceptance is needed
- Handles navigation to full terms page via `onNavigateToTerms`
- Manages terms acceptance state

### 3. Terms Screen (existing)
Your existing Terms.tsx screen with the complete terms content.

## Integration Steps

### Step 1: Update your main app component

```tsx
import { TermsGate } from '../components/TermsGate';
import { useNavigation } from '@react-navigation/native';

function App() {
  const navigation = useNavigation();

  const handleNavigateToTerms = () => {
    navigation.navigate('Terms'); // Navigate to your existing Terms screen
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

### Step 3: Optional - Add acceptance button to Terms screen

If you want users to be able to accept terms from the full Terms screen:

```tsx
// Add to Terms.tsx
import { useAcceptTerms } from '../hooks/useAcceptTerms';
import { supabase } from '../config/supabaseClient';
import Button from '../components/Button';

export default function Terms() {
  const { needsAcceptance } = useAcceptTerms();
  const user = useUser();

  const handleAcceptFromFullTerms = async () => {
    if (!user?.uid) return;
    
    const { error } = await supabase.rpc('grant_app_access', {
      p_user_id: user.uid,
      p_app_name: 'yours-brightly',
      p_terms_version: '2.0'
    });

    if (!error) {
      navigation.goBack(); // Or navigate to main app
    }
  };

  return (
    <View style={styles.container}>
      <ScrollView>
        {/* existing terms content */}
      </ScrollView>
      
      {needsAcceptance && (
        <Button onPress={handleAcceptFromFullTerms}>
          Accept Terms & Continue
        </Button>
      )}
    </View>
  );
}
```

## User Flow

1. **User opens app** → TermsGate checks if terms acceptance needed
2. **Terms required** → AcceptTermsModal shows with summary
3. **User taps "View Full Terms"** → Navigates to Terms screen
4. **User reads full terms** → Can accept from modal or Terms screen
5. **Terms accepted** → JWT refreshed with app permissions, user gains access

## Customization

### Change terms summary
Edit `TERMS_CONTENT` in `AcceptTermsModal.tsx`:

```tsx
const TERMS_CONTENT = {
  'yours-brightly': {
    title: 'Your Custom Title',
    summary: `Your custom summary with key points...`,
    fullTermsAvailable: true
  }
};
```

### Add version checking
Update `CURRENT_TERMS_VERSION` in `useAcceptTerms.ts` to force re-acceptance:

```tsx
const CURRENT_TERMS_VERSION = '3.0'; // Users must re-accept
```

### Custom styling
Both components accept style props and can be customized via the existing style objects.

## Notes

- The modal shows a summary, not the full terms text
- Full terms should be in your existing Terms.tsx screen
- Terms acceptance is recorded in `user_app_permissions` table
- JWT is automatically refreshed after acceptance
- Version changes force all users to re-accept terms