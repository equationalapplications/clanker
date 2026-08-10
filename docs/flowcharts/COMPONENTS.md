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
  ChatComposer --> apiClient
  ChatComposer.web --> useChatPhotoUpload
  ChatComposer.web --> useCharacterWiki
  ChatComposer.web --> documentMimeTypes
  ChatComposer.web --> apiClient
  ChatImageBubble --> useResolvedImage
  ChatView --> usePowerBalance
  ChatView --> useAIChat
  ChatView --> useResolvedImage
  ChatView --> isSafeHttpUrl
  ChatView --> useMachines
  ChatView --> useCharacters
  ChatView --> useActiveCharacterId
  CombinedSubscriptionButton --> useCurrentPlan
  CookieConsentBanner --> CookieConsentContext
  CookieConsentContext --> crashlyticsService
  CookieConsentContext --> analyticsService
  CookiePreferencesModal --> CookieConsentContext
  CreditsDisplay --> useUserCredits
  CreditsDisplay --> useBootstrapRefresh
  CreditsDisplay --> useAuthSnapshot
  GroundingHtml --> sanitizeGroundingHtml
  GroundingHtml --> isSafeHttpUrl
  GroundingHtml.web --> groundingShadowContent
  FeaturesSection --> useFloatingCardAnimation
  HeroSection --> useMachines
  LandingFooter --> CookieConsentContext
  LowPowerBanner --> usePowerBalance
  LowPowerBanner --> lowPowerSession
  PowerMeter --> useCurrentPlan
  PowerMeter --> usePowerBalance
  SubscribeButton --> useBootstrapRefresh
  ThemeProvider --> SettingsContext
  ConfirmationModal --> confirmationValidation
  UserActionPanel --> renewalDateValidation
```
