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
  CookieConsentContext --> analyticsService
  CookiePreferencesModal --> CookieConsentContext
  CreditsDisplay --> useUserCredits
  CreditsDisplay --> useBootstrapRefresh
  GroundingHtml --> sanitizeGroundingHtml
  GroundingHtml --> isSafeHttpUrl
  GroundingHtml.web --> groundingShadowContent
  FeaturesSection --> useFloatingCardAnimation
  HeroSection --> useMachines
  LandingFooter --> CookieConsentContext
  LowPowerBanner --> usePowerBalance
  PowerMeter --> useCurrentPlan
  PowerMeter --> usePowerBalance
  SubscribeButton --> useBootstrapRefresh
  ThemeProvider --> SettingsContext
  ConfirmationModal --> confirmationValidation
  UserActionPanel --> renewalDateValidation
```
