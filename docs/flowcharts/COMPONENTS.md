# components file dependencies

_Auto-generated. Run `npm run docs:charts` to regenerate._
```mermaid
graph LR
  ChatComposer --> useCharacterWiki
  ChatComposer --> documentMimeTypes
  ChatComposer --> apiClient
  ChatComposer.web --> useCharacterWiki
  ChatComposer.web --> documentMimeTypes
  ChatComposer.web --> apiClient
  ChatView --> useUserCredits
  ChatView --> useAIChat
  ChatView --> isSafeHttpUrl
  ChatView --> useMachines
  ChatView --> useCharacters
  ChatView --> useActiveCharacterId
  CombinedSubscriptionButton --> useCurrentPlan
  CookieConsentBanner --> CookieConsentContext
  CookieConsentContext --> crashlyticsService
  CookiePreferencesModal --> CookieConsentContext
  CreditCounterIcon --> useCurrentPlan
  CreditCounterIcon --> useUserCredits
  CreditsDisplay --> useUserCredits
  CreditsDisplay --> useBootstrapRefresh
  GroundingHtml --> sanitizeGroundingHtml
  GroundingHtml --> isSafeHttpUrl
  GroundingHtml.web --> groundingShadowContent
  ComingSoonSection --> useFloatingCardAnimation
  FeaturesSection --> useFloatingCardAnimation
  HeroSection --> useMachines
  LandingFooter --> CookieConsentContext
  SubscribeButton --> useBootstrapRefresh
  ThemeProvider --> SettingsContext
  ConfirmationModal --> confirmationValidation
  UserActionPanel --> renewalDateValidation
```
