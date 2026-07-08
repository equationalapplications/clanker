// ... (keep all existing imports and code, only change the dev sandbox subscription)

// Inside the dev sandbox fallback (around line 68):
      subscription: {
        planTier: 'free',
        planStatus: 'active',
        currentCredits: 5000,   // was 100
        grantedTotal: 0,
        termsVersion: '2.2',
        termsAcceptedAt: new Date().toISOString(),
        nextExpiryDate: null,
      },
// ... rest of file unchanged
