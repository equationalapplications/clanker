# components file dependencies

_Auto-generated. Run `npm run docs:charts` to regenerate._

```mermaid
graph LR
  AvatarPicker --> useMachines
  AvatarPicker --> characterImageDatabase
  AvatarPicker --> localImageStore
  AvatarPicker --> useAvatarUpload
  AvatarPicker --> useImageGeneration
  AvatarPicker --> characterImageSyncService
  AvatarPicker --> characterImageService
  CharacterCard --> useResolvedImage
  ChatComposer --> useChatPhotoUpload
  ChatComposer --> useCharacterWiki
  ChatComposer --> documentMimeTypes
  CombinedSubscriptionButton --> useCurrentPlan
  CookieConsentBanner --> CookieConsentContext
  CookieConsentContext --> crashlyticsService
  CookieConsentContext --> analyticsService
  CookiePreferencesModal --> CookieConsentContext
  CreditsDisplay --> useUserCredits
  CreditsDisplay --> useBootstrapRefresh
  CreditsDisplay --> useAuthSnapshot
  GroundingFooter --> isSafeHttpUrl
  GroundingHtml --> sanitizeGroundingHtml
  GroundingHtml --> isSafeHttpUrl
  GroundingHtml.web --> groundingShadowContent
  FeaturesSection --> useFloatingCardAnimation
  HeroSection --> useMachines
  LandingFooter --> CookieConsentContext
  LowPowerBanner --> usePowerBalance
  LowPowerBanner --> lowPowerSession
  MessageText --> linkifyUrls
  MessageText --> isSafeHttpUrl
  PowerMeter --> useCurrentPlan
  PowerMeter --> usePowerBalance
  SubscribeButton --> useBootstrapRefresh
  ThemeProvider --> SettingsContext
  ConfirmationModal --> confirmationValidation
  UserActionPanel --> renewalDateValidation
  ChatView --> usePowerBalance
  ChatView --> useResolvedImage
  ChatView --> useMachines
  ChatView --> useCharacters
  ChatView --> useActiveCharacterId
  ChatImageBubble --> useResolvedImage
  ChatImageBubble --> photoLibrarySaver
```
