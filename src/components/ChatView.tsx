// ... after all imports and before the component definition, ensure LowPowerBanner is imported:
import { LowPowerBanner } from '~/components/LowPowerBanner'

// ... inside the ChatViewContent component, after the status View and before GiftedChat, add:

<View style={styles.container}>
  {(wikiStatus.ingesting || wikiStatus.librarian || isGeneratingResponse || documentPhase !== null || activeTool) && (
    <View
      accessibilityLiveRegion="polite"
      accessibilityRole={Platform.OS === 'web' ? ('status' as any) : undefined}
    >
      {/* existing status text */}
    </View>
  )}
  <LowPowerBanner />
  <GiftedChat ... />
</View>
